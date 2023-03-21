import mongoose from 'mongoose';
import { MongoClient } from 'mongodb';

const connectionClient = (): MongoClient => {
  return mongoose.connection.getClient()
};

export default connectionClient;
