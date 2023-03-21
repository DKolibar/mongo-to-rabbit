import mongoose, { Schema } from 'mongoose';

interface ChangeStream {
  description: Object;
  eventId: String;
  createdAt: Date;
}

// changeStreamSchema is the schema that document when is the last
// change event for reliability
const changeStreamSchema = new Schema({
  description: Object,
  eventId: { type: String, unique: true },
  createdAt: { type: Date },
}, {versionKey: false});

const changeStreamTrackerModel = (eventsCollectionDb: string): mongoose.Model<any> => {
  return mongoose.connection.useDb(eventsCollectionDb).model<ChangeStream & mongoose.Document>('record', changeStreamSchema);
};

export default changeStreamTrackerModel;
