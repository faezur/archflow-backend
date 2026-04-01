const mongoose = require('mongoose');
const { Schema } = mongoose;

const renderSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  imageUrl: {
    type: String,
    required: true
  },

  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending',
    required: true
  },

  generatedImageUrl: {
    type: String,
    default: null
  },

  groqPrompt: {
    type: String,
    default: null
  }

}, { timestamps: true });

module.exports = mongoose.model('Render', renderSchema);