const mongoose = require('mongoose');

const renderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
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
    default: 'pending'
  },
  generatedImageUrl: {
  type: String,
  default: ''
  },
  groqPrompt: {
    type: String,
    default: ''
  },
}, { timestamps: true });

module.exports = mongoose.model('Render', renderSchema);