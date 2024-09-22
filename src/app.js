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
app.use(express.json());
// Connect to MongoDB
async function connectToDB() {
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to MongoDB');
}
connectToDB();

let userData = {};

// Start Command
bot.start((ctx) => {
  const chatId = ctx.chat.id;
  console.log(chatId)
  ctx.reply(
    'Welcome! Please select your hostel:',
    Markup.keyboard([
      ['Hostel A', 'Hostel B'],
      ['Hostel C', 'Hostel D'],
    ]).resize()
  );
});

const adminBot = new Telegraf(process.env.ADMIN_BOT_TOKEN);  // Use the same bot token if not using a separate admin bot
adminBot.start((ctx) => {
  console.log(`Admin Chat ID: ${ctx.chat.id}`); // Log the chat ID to capture it
  ctx.reply('Admin bot started.');
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

// app.post('/webhook', async (req, res) => {
//   try {
//     const { data } = req.body;
//     const { link_id, transaction_status } = data.order;
//     const { customer_phone, link_status } = data.customer_details;

//     // Retrieve the user using paymentId
//     const user = await User.findOne({ paymentId: link_id });

//     if (!user) {
//       return res.status(400).json({ message: 'User not found' });
//     }

//     const chatId = user.chatId;

//     if (!chatId) {
//       return res.status(400).json({ message: 'Missing chatId' });
//     }

//     // Update the user's payment status in the database
//     if (transaction_status === 'SUCCESS') {
//       await User.updateOne({ chatId }, { paymentStatus: 'completed' });

//       // Notify the user about successful payment via the Telegram bot
//       await bot.telegram.sendMessage(chatId, 'Payment was successful! Your order will be delivered shortly.');

//       // Generate the order summary
//       let orderSummary = `New Order Received:\n\nAddress: ${user.address}\nItems:\n`;
//       user.orders.forEach(order => {
//         if (order.quantity > 0) {
//           orderSummary += `- ${order.quantity} ${order.item}(s)\n`;
//         }
//       });
      
//       orderSummary += `\nTotal Amount: ₹${user.orders.reduce((sum, order) => sum + getPrice(order.item, order.quantity), 0)}`;

//       // Send order summary to admin bot or admin user in the same bot
//       const adminChatId = process.env.ADMIN_CHAT_ID;  // Add this in your .env
//       // const adminBot = new Telegraf(process.env.ADMIN_BOT_TOKEN);  // Use the same bot token if not using a separate admin bot
      
//       await adminBot.telegram.sendMessage(adminChatId, orderSummary);

//     } else if (link_status === 'PARTIALLY_PAID') {
//       await User.updateOne({ chatId }, { paymentStatus: 'partially_paid' });

//       await bot.telegram.sendMessage(chatId, `Your payment was partially successful. Amount paid: ${data.link_amount_paid}. Please complete the payment.`);
//     } else {
//       await User.updateOne({ chatId }, { paymentStatus: transaction_status });

//       // Notify the user about the current payment status via the Telegram bot
//       await bot.telegram.sendMessage(chatId, `Payment status: ${transaction_status}. Please contact support if needed.`);
//     }

//     // Respond to Cashfree to acknowledge the request
//     res.sendStatus(200);
//   } catch (error) {
//     console.error('Error handling webhook:', error);
//     res.status(500).json({ message: 'Internal server error' });
//   }
// });



// Launch bot

// app.post('/webhook', async (req, res) => {
//   try {
//     const { data } = req.body;
//     const { link_id, transaction_status } = data.order; // Adjust structure if needed
//     const { customer_phone, link_status } = data.customer_details;
//     console.log(req.body);

//     // Retrieve the user using paymentId
//     const user = await User.findOne({ paymentId: data.link_id }); // Corrected structure

//     if (!user) {
//       return res.status(400).json({ message: 'User not found' });
//     }

//     const chatId = user.chatId;

//     if (!chatId) {
//       return res.status(400).json({ message: 'Missing chatId' });
//     }

//     // Update the user's payment status in the database
//     if (transaction_status === 'SUCCESS') {
//       await User.updateOne({ chatId }, { paymentStatus: 'completed' });

//       // Notify the user about successful payment via the Telegram bot
//       await bot.telegram.sendMessage(chatId, 'Payment was successful! Your order will be delivered shortly.');

//       // Generate the order summary
//       let orderSummary = `New Order Received:\n\nAddress: ${user.address}\nItems:\n`;
//       user.orders.forEach(order => {
//         if (order.quantity > 0) {
//           orderSummary += `- ${order.quantity} ${order.item}(s)\n`;
//         }
//       });

//       orderSummary += `\nTotal Amount: ₹${user.orders.reduce((sum, order) => sum + getPrice(order.item, order.quantity), 0)}`;

//       // Send order summary to admin bot or admin user in the same bot
//       const adminChatId = process.env.ADMIN_CHAT_ID;
      
//       await adminBot.telegram.sendMessage(adminChatId, orderSummary);

//     // } else if (link_status === 'PARTIALLY_PAID') {
//     //   await User.updateOne({ chatId }, { paymentStatus: 'partially_paid' });

//     //   await bot.telegram.sendMessage(chatId, `Your payment was partially successful. Amount paid: ${data.link_amount_paid}. Please complete the payment.`);
//     } else {
//       await User.updateOne({ chatId }, { paymentStatus: transaction_status });

//       // Notify the user about the current payment status via the Telegram bot
//       await bot.telegram.sendMessage(chatId, `Payment status: ${transaction_status}. Please contact support if needed.`);
//     }

//     // Respond to Cashfree to acknowledge the request
//     res.sendStatus(200);
//   } catch (error) {
//     console.error('Error handling webhook:', error);
//     res.status(500).json({ message: 'Internal server error' });
//   }
// });

// Webhook for Cashfree Payment Confirmation
app.post('/cashfree-webhook', async (req, res) => {

  // Extract relevant data from webhook payload
  
  try {
      console.log(req);
      const { link_id, link_status } = req.body.data; 
      const {transaction_status} = req.body.data.order;
    if (transaction_status === 'SUCCESS') {
      // Find the user by paymentId
      console.log("hello vai")
      const user = await User.findOne({ paymentId: link_id });
      console.log(user)

      if (user) {
        // Update the payment status to 'confirmed'
        await User.updateOne({ paymentId: link_id }, { paymentStatus: 'confirmed' });

        // Send confirmation message to the user
        await bot.telegram.sendMessage(user.chatId, 'Payment received! Your order is being processed.');
        
        // Optionally, notify the restaurant admin
        const adminChatId = process.env.ADMIN_CHAT_ID;  // Set admin chat ID in your environment variables
        // await adminBot.telegram.sendMessage(adminChatId, `New order from ${user.address} is confirmed and paid.`);


        let orderSummary = `New Order Received:\n\nAddress: ${user.address}\nItems:\n`;
      user.orders.forEach(order => {
        if (order.quantity > 0) {
          orderSummary += `- ${order.quantity} ${order.item}(s)\n`;
        }
      });

      orderSummary += `\nTotal Amount: ₹${user.orders.reduce((sum, order) => sum + getPrice(order.item, order.quantity), 0)}`;

      // Send order summary to admin bot or admin user in the same bot
      // const adminChatId = process.env.ADMIN_CHAT_ID;
      
      await adminBot.telegram.sendMessage(adminChatId, orderSummary);
      }
    }

    res.status(200).send('Webhook received');
  } catch (error) {
    console.error('Error in webhook handling:', error);
    res.status(500).send('Internal Server Error');
  }
});




bot.launch();
console.log('Bot is running...');
adminBot.launch();
console.log('admin bot is running...');

