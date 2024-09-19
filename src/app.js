require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const User = require('./models/User');
const axios = require('axios');
const express = require("express");
const app = express();
app.listen(8080, () => console.log("server is up and running"));
const { v4: uuidv4 } = require('uuid');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Connect to MongoDB
async function connectToDB() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to MongoDB');
}
connectToDB();

let userData = {};

// Start Command
bot.start((ctx) => {
  ctx.reply(
    'Welcome! Please select your hostel:',
    Markup.keyboard([
      ['Hostel A', 'Hostel B'],
      ['Hostel C', 'Hostel D'],
    ]).resize()
  );
});

// Handle address selection (hostel)
bot.hears(['Hostel A', 'Hostel B', 'Hostel C', 'Hostel D'], async (ctx) => {
  const hostel = ctx.message.text;
  await User.updateOne(
    { chatId: ctx.chat.id },
    { chatId: ctx.chat.id, address: hostel, orders: [], paymentId: null, paymentStatus: 'pending' },
    { upsert: true }
  );

  ctx.reply(
    `You selected ${hostel}. Now, choose your items from the menu:`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Pizza', 'item_Pizza')],
      [Markup.button.callback('Burger', 'item_Burger')],
      [Markup.button.callback('Salad', 'item_Salad')],
      [Markup.button.callback('Checkout', 'checkout')],
    ])
  );
});

// Handle menu item selection
bot.action(/item_(.+)/, async (ctx) => {
  const item = ctx.match[1];
  const chatId = ctx.chat.id;

  userData[chatId] = userData[chatId] || { step: 1 };
  userData[chatId].step = 1;
  userData[chatId].currentItem = item;

  // Add item to user orders in MongoDB
  await User.updateOne(
    { chatId },
    { $push: { orders: { item, quantity: 0 } } }
  );

  ctx.reply(`You selected ${item}. Please enter the quantity or type "Checkout" to finalize your order:`);
});

// Handle quantity input or checkout
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  if (userData[chatId] && userData[chatId].step === 1) {
    const text = ctx.message.text;

    if (text.toLowerCase() === 'checkout') {
      const user = await User.findOne({ chatId });
      let orderSummary = `Order Summary:\n\nAddress: ${user.address}\n\nItems:\n`;
      
      user.orders.forEach(order => {
        if (order.quantity > 0) {
          orderSummary += `- ${order.quantity} ${order.item}(s)\n`;
        }
      });

      if (orderSummary === `Order Summary:\n\nAddress: ${user.address}\n\nItems:\n`) {
        orderSummary += 'No items selected.';
      }

      // Generate Cashfree payment link
      const paymentLink = await generateCashfreePaymentLink(chatId, ctx.from.first_name, user);

      ctx.reply(orderSummary);
      ctx.reply(`Thank you for your order! Please complete your payment using the following link:\n${paymentLink}`);
      
    } else {
      const quantity = parseInt(text);
      if (isNaN(quantity) || quantity <= 0) {
        return ctx.reply('Please enter a valid quantity.');
      }

      // Update the quantity for the current item
      await User.updateOne(
        { chatId, 'orders.item': userData[chatId].currentItem },
        { $set: { 'orders.$.quantity': quantity } }
      );

      ctx.reply(`Quantity of ${userData[chatId].currentItem} set to ${quantity}. You can choose more items or type "Checkout" to finalize.`);
    }
  }
});


// Generate Cashfree Payment Link with Curl Request
async function generateCashfreePaymentLink(chatId, userName, user) {
  const totalAmount = user.orders.reduce((sum, order) => sum + getPrice(order.item, order.quantity), 0);

  const paymentData = {
    customer_details: {
      customer_phone: '9602866736' // Example phone, replace with actual phone from user if available
    },
    link_notify: {
      send_sms: true,
      send_email: false
    },
    link_id: uuidv4(),
    link_amount: totalAmount,
    link_currency: 'INR',
    link_purpose: `OAC order by ${userName}`
  };

  try {
    const response = await axios.post('https://sandbox.cashfree.com/pg/links', paymentData, {
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
        'x-api-version': '2023-08-01'
      }
    });

    console.log('Cashfree response:', response.data);
    

    await User.updateOne(
      { chatId },
      { paymentId: response.data.link_id }
    );

    return response.data.link_url;
  } catch (error) {
    console.error('Error creating Cashfree payment link:', error.response ? error.response.data : error.message);
    return '#'; // Return an invalid URL if there's an error
  }
}

// Function to calculate price based on menu
function getPrice(item, quantity) {
  const prices = { Pizza: 200, Burger: 150, Salad: 100 };
  return prices[item] * quantity;
}



// Launch bot
bot.launch();
console.log('Bot is running...');
