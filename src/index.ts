import mongoose from 'mongoose';
import mongodb from 'mongodb';
import { MongoDataType, RabbitDataType, DataObjectType } from './paramTypes';
import { menash } from 'menashmq';

// TODO: add options. 
/**
 * The main function of the package.
 * Cteares the listener to mongo and connects it to rabbit.
 * @param mongoData - Information related to mongo.
 * @param rabbitData - Information related to rabbitMQ.
 */
export async function watchAndNotify(mongoData: MongoDataType, rabbitData: RabbitDataType) {
    console.log('connecting to rabbitMQ');
    await menash.connect(rabbitData.rabbitURI);
    await menash.declareQueue(rabbitData.queueName, {durable: true});

    console.log('connecting to mongo')
    connectToMongo(mongoData.mongoURI, mongoData.dbName, mongoData.replicaSet);
    const pipeline = [{ $match: { 'ns.db': mongoData.dbName, 'ns.coll': mongoData.collectionName } }];
    initWatch(mongoData.mongoModel, pipeline, rabbitData.queueName, mongoData.prettify);
}

/**
 * Connects to the mongo collection required to be watched.
 * @param mongoURI - the URI to connect to mongo.
 * @param dbName - the DB name.
 * @param replicaSet - The name of the replicaSet.
 */
async function connectToMongo(mongoURI: string, dbName: string, replicaSet: string) {
    // Connect to the replica set
    // TODO: username and password - ?
    const connectionString : string = `${mongoURI}/${dbName}?replicaSet=${replicaSet}`;
    console.log(`connecting to ${connectionString}`);
    await mongoose.connect(connectionString, { useNewUrlParser: true });
}

/**
 * Initializes the mongo watcher, given the mongo data.
 * @param model - the mongoose model.
 * @param pipeline - contains the db name and collection name.
 * @param qName - The name of the queue to publish to.
 * @param prettify - boolean, wheather or not to prettify the information sent.
 */
function initWatch(model: mongoose.Model<mongoose.Document>, pipeline: any, qName: string, prettify: boolean){
    model.watch(pipeline).on('change', async (data: mongodb.ChangeEvent<Object>) => {
        if (!data) return;
        if (prettify) {
            const operation: string = data.operationType || 'unknown';
            let id : string = 'null'; 
            if((<any>data).documentKey) {
                id = (<any>data).documentKey._id;
            }

            // Create the basic dataObject
            let dataObject: DataObjectType = { operation, id, fullDocument: {}, updateDecsctiption: { updatedFields: {}, removedFields: []} };
    
            switch (operation) {
                case 'insert':
                    dataObject.fullDocument = (<any>data).fullDocument;
                    break;
                case 'replace':
                    dataObject.fullDocument = (<any>data).fullDocument;
                    break;
                case 'update':
                    dataObject.fullDocument = (<any>data).fullDocument
                    dataObject.updateDecsctiption = (<any>data).updateDescription;
                    break;
                case 'delete':
                    break;
                default:
                    console.log(`An unknown operation occured: ${operation}`);
            }
            menash.send(qName, { operation, data: dataObject });

            return;
        }
        menash.send(qName, data);

    });
    console.log('finished initWatch');
}
