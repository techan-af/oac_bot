const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const User = require('../models/User');

const app = express();
app.use(bodyParser.json());

app.post('/webhook', async (req, res) => {
  const secret = process.env.CASHFREE_WEBHOOK_SECRET;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(req.body));
  const generatedSignature = hmac.digest('hex');
  const receivedSignature = req.headers['x-cashfree-signature'];

  if (generatedSignature === receivedSignature) {
    const { order_id, order_status } = req.body;
    if (order_status === 'PAID') {
      const chatId = order_id.split('_')[1];
      await User.updateOne({ chatId }, { paymentStatus: 'paid' });
      console.log('Payment captured for order:', order_id);
    }
    res.status(200).send('Webhook received');
  } else {
    res.status(400).send('Invalid signature');
  }
});

app.listen(3000, () => {
  console.log('Webhook server running on port 3000');
});
