import mongoose, { ConnectOptions } from 'mongoose';
import { ChangeStreamOptions, ChangeEvent, ResumeToken } from 'mongodb';
import sleep from './general';
import changeStreamTrackerModel from '../models/changeStreamModel';
import { logger } from '../index';
import { formatAndSendMsg } from './message';
import { MongoDataType, MTROptions, RabbitDataType } from '../paramTypes';
import { criticalLog } from './logger';
import connectionClient from '../models/connectionClient';

// Global variables
const mongoOptions: ConnectOptions = {
  useNewUrlParser: true,
  useFindAndModify: false,
  useCreateIndex: true,
  useUnifiedTopology: true,
};

/**
 * Get mongo connection health status
 * @returns {boolean} isHealthy - true if healthy
 */
export function getMongoHealthStatus(): boolean {
  return mongoose.connection.readyState === 1;
}

export class MongoWatcher {
  mongoData: MongoDataType;

  rabbitData: RabbitDataType;

  options: MTROptions;

  healthCheckInterval = 30000;

  /**
   * Creates MongoWatcher instance
   * @param {MongoDataType}   mongoData   - mongo uri and collection name
   * @param {RabbitDataType}  rabbitData  - rabbit data
   * @param {MTROptions}      options     - mongo to rabbit options
   */
  constructor(mongoData: MongoDataType, rabbitData: RabbitDataType, options: MTROptions) {
    this.mongoData = mongoData;
    this.rabbitData = rabbitData;
    this.options = options;
    if (mongoData.healthCheckInterval) this.healthCheckInterval = mongoData.healthCheckInterval;
  }

  /**
   * Starts mongo connection
   */
  async mongoConnection(): Promise<void> {
    while (true) {
      try {
        logger.log(
          `try connect mongo uri: ${this.mongoData.connectionString}`
        );
        await mongoose.connect(this.mongoData.connectionString, mongoOptions);
        logger.log(`successful connection to mongo on connectionString: ${this.mongoData.connectionString}`);

        this.initWatch();
        break;
      } catch (error) {
        criticalLog(`can't connect to mongo. Retrying in ${this.healthCheckInterval}ms`);
        criticalLog(error);

        await sleep(this.healthCheckInterval);
      }
    }
  }

  /**
   * Initiate collection watcher change stream from last event id. if none found, returns undefiend
   */
  async initiateChangeStreamStartTime(): Promise<any> {
    // Get the last event
    const latestEvent: any = await changeStreamTrackerModel(this.mongoData.eventDatabase, this.mongoData.connectionName)
      .findOne({})
      .sort({ createdAt: -1 });
    const latestEventId = latestEvent && latestEvent.eventId;

    return latestEventId;
  }

  /**
   * Initializes the mongo watcher, given the mongo data.
   */
  async initWatch(): Promise<void> {
    // Get the last event id that successfully sent to rabbit
    const lastEventId = await this.initiateChangeStreamStartTime();

    const pipeline = [{ $match: { $nor: [{'ns.db': `${this.mongoData.eventDatabase}`}] } }];
    const connection = connectionClient();
    const optionsStream: ChangeStreamOptions = { fullDocument: 'updateLookup' };

    if (lastEventId) {
      const startAfterToken: ResumeToken = {};
      (startAfterToken as any)._data = lastEventId;
      optionsStream.startAfter = startAfterToken;
    }

    const changeStream = connection.watch(pipeline, optionsStream);

    // start listen to changes
    changeStream
      .on('change', async (event: ChangeEvent<any>) => {
        logger.log(`got mongo event: ${event.operationType}, `);

        try {
          // Try send msg to all queues
          await Promise.all(
            this.rabbitData.queues.map(async (queue) => formatAndSendMsg(queue, this.options, event, this.mongoData))
          );

          const eventId = (event._id as any)._data;
          // Update event stream document
          changeStreamTrackerModel(this.mongoData.eventDatabase, this.mongoData.connectionName).findOneAndUpdate(
            { eventId: lastEventId },
            { eventId, description: event, createdAt: Date.now() },
            { upsert: true },
            async (err: any) => {
              if (err) criticalLog(`err in create event time ${err}`);
              else {
                try {
                  await changeStreamTrackerModel(this.mongoData.eventDatabase, this.mongoData.connectionName);
                } catch (error) {
                  criticalLog(
                    `cant remove before events in collection ${this.mongoData.connectionName}, err: ${error}`
                  );
                }
              }
            }
          );
        } catch (error) {
          criticalLog(`something went wrong in rabbit send msg ${error}`);
        }
      })
      .on('error', async (err: any) => {
        criticalLog('error in mongo');
        criticalLog(err);
        await this.mongoConnection();
      });

    logger.log('successful connection to mongo');
  }
}
