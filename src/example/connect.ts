import { watchAndNotify } from '../index';
import { MongoDataType, MTROptions, RabbitDataType, DataObjectType, MiddlewareFuncType } from '../paramTypes';

// Create two colQCouples and connect to two different queues.

// First colQCouple
// const middleware1: MiddlewareFuncType = (x: DataObjectType) => {
//   const x2: DataObjectType = x;
//   x2.operation += '!!!';
//   return x;
// };

const mongoData1: MongoDataType = {
  eventDatabase: 'aaa',
  connectionString: (process.env.MONGODB_URI as string || 'mongodb://localhost:27017/devDB?replicaSet=rs0')
};
const rabbitData1: RabbitDataType = {
  exchange: {name: 'ex1', type: 'fanout'},
  queues: [{name: 'q1'}, {name: 'q2'}],
  rabbitURI: (process.env.RABBITMQ_URI as string || 'amqp://localhost'),
};

const options1: Partial<MTROptions> = { silent: false, prettify: true };

// Second colQCouple
// const mongoData2: MongoDataType = {
//   collectionName: 'permissions',
//   connectionString: 'mongodb://localhost:27017/devDB?replicaSet=rs0',
// };
//
// const rabbitData2: RabbitDataType = {
//   queues: [{ name: 'MyQueueName2' }],
//   rabbitURI: 'amqp://localhost',
// };

watchAndNotify(mongoData1, rabbitData1, options1);
// watchAndNotify(mongoData2, rabbitData2);
