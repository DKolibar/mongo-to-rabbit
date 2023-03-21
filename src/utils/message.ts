import { ChangeEvent } from 'mongodb';
import { ExchangeSendProperties, menash, QueueSendProperties } from 'menashmq';
import { logger } from '../index';
import { errorModel, IError } from '../models/errorMsgModel';
import {
  DataObjectType,
  MiddlewareFuncType,
  MongoDataType,
  MTROptions,
  QueueObjectType,
  ChangeOperation, ExchangeObjectType
} from '../paramTypes';
import { criticalLog } from './logger';

const defaultMiddleware: MiddlewareFuncType = (data: DataObjectType) => data;

const sendMsgTimeout = 30000;

/**
 * formatAndSendMsg - parse msg and send it to queue
 * @param {QueueObjectType}             queue     - queue object
 * @param {MTROptions}                  options   - options for package
 * @param {ChangeEvent<Object>} event     - mongo change event
 * @param {MongoDataType}               mongoData - mongoData options
 */
export async function formatAndSendMsg(
  exchange: ExchangeObjectType,
  options: MTROptions,
  event: ChangeEvent<any>,
  mongoData: MongoDataType
): Promise<void> {
  let formattedData;

  if (options.prettify) {
    formattedData = defaultMiddleware(prettifyData(event), mongoData.connectionName);
  } else {
    formattedData = event;
  }

  if (formattedData) {
    Array.isArray(formattedData)
      ? await Promise.all(formattedData.map(async (dataContent) => sendMsg(exchange, dataContent, true)))
      : await sendMsg(exchange, formattedData, true);
  }
}

/**
 * sendMsg function to queue - by exchange or direct queue
 * @param {ExchangeObjectType} exchange   - exchange object
 * @param {any}             msg     - formatted msg
 * @param {boolean}         isMongoWatcher - is msg from mongo watcher or initiated manually
 * @param {number}          msgTimeout - timeout in milliseconds for send msg
 */
export async function sendMsg(
  exchange: ExchangeObjectType,
  msg: any,
  isMongoWatcher = false,
  msgTimeout: number = sendMsgTimeout
): Promise<void> {
  // mark our messages as persistent, tells rabbitmq to save the message for durability
  const sendProperties: ExchangeSendProperties | QueueSendProperties = { deliveryMode: 2 };

  const sender = async () => {
    await menash.send(exchange.name, msg, sendProperties);
  };

  // Check if send msg to rabbit was succesful, defines a timeout for the sender
  await Promise.race([
    sender(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), msgTimeout)),
  ]).catch((err) => {
    const errMsg = `error in sending rabbit msg, ${err}`;
    if (isMongoWatcher) throw new Error(errMsg);

    // Create error rabbit sender
    criticalLog(errMsg);
    const errorDoc: IError = { formattedMsg: msg, destExchange: exchange, error: err };
    errorModel.create(errorDoc, async (error: any) => {
      err ? console.error('err in create error msg doc', errorDoc, error) : criticalLog('send to rabbit error');
    });
  });
}

/**
 * prettifyData formats the data sent from the change event on mongo.
 * @param {ChangeEvent<any>} data    - the information sent from mongo about the change.
 * @returns an object of type DataObjectType.
 */
export function prettifyData(data: ChangeEvent<any>): DataObjectType {
  // Create the basic dataObject
  // {"id":"63f8b944d021270bdbf01f6d","operation":"update","fullDocument":{"_id":"63f8b944d021270bdbf01f6d","authorId":"84218830-b493-4be1-87d5-2ec9dab4d0e2","name":"Dupľa","distance":28242.1,"elapsedTime":20815,"totalElevationGain":1405.1,"sportType":"MountainBikeRide","startDate":"2022-10-28T07:32:32.000Z","averageSpeed":2.16,"gpxFilePath":"stravaimporter/gpx/1677244741-f47182c4-f290-4639-b03a-5e73607284ae.gpx","extra":{"strava_id":8031987603,"average_watts":178.2,"moving_time":13074},"credibilityOfGxpFile":-0.02069878578186035,"flagged":false,"gpxSum":"xxxxxxbxlxxabla"},"updateDescription":{"updatedFields":{"gpxSum":"xxxxxxbxlxxabla"},"removedFields":[],"truncatedArrays":[]}}

  const dataObject: DataObjectType = {
    id: 'null',
    operation: ChangeOperation.UNKNOWN,
    fullDocument: {},
    db: 'null',
    coll: 'null',
    updateDescription: { updatedFields: {}, removedFields: [] },
  };

  if (!data) return dataObject;

  dataObject.db = (<any>data).ns.db;
  dataObject.coll = (<any>data).ns.coll;

  dataObject.operation = data.operationType || ChangeOperation.UNKNOWN;
  if ((<any>data).documentKey) dataObject.id = (<any>data).documentKey._id;

  switch (dataObject.operation) {
    case ChangeOperation.INSERT:
      dataObject.fullDocument = (<any>data).fullDocument;
      break;
    case ChangeOperation.REPLACE:
      dataObject.fullDocument = (<any>data).fullDocument;
      break;
    case ChangeOperation.UPDATE:
      dataObject.fullDocument = (<any>data).fullDocument;
      dataObject.updateDescription = (<any>data).updateDescription;
      break;
    case ChangeOperation.DELETE:
      break;
    default:
      logger.log(`An unknown operation occurred: ${dataObject.operation}`);
  }

  return dataObject;
}

/** sendFailedMsg - send failed msg * */
export async function sendFailedMsg(): Promise<void> {
  try {
    const failedMsgs: IError[] = await errorModel.find({}).sort({ createdAt: -1 });
    await errorModel.deleteMany({});
    await Promise.all(failedMsgs.map(async (failedmsg) => await sendMsg(failedmsg.destExchange, failedmsg.formattedMsg)));
  } catch (error) {
    criticalLog(error);
  }
}
