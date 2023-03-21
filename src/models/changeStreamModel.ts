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
  createdAt: { type: Date, default: Date.now },
}, {versionKey: false});

const changeStreamTrackerModel = (eventsCollectionDb: string, eventsCollectionName: string): mongoose.Model<any> => {
  return mongoose.connection.useDb(eventsCollectionDb).model<ChangeStream & mongoose.Document>(eventsCollectionName, changeStreamSchema);
};

export default changeStreamTrackerModel;
