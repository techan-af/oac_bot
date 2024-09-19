const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  chatId: { type: String, required: true, unique: true },
  address: String,
  orders: [{ item: String, quantity: Number }],
  paymentId: String,
  paymentStatus: { type: String, default: 'pending' },
});

module.exports = mongoose.model('User', userSchema);
