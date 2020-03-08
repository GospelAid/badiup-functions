const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const stripe = require('stripe')(functions.config().stripe.token);
const express = require('express');
const app = express();

app.post('/create-payment-intent', async (req, res) => {
    const { userId, paymentMethodId } = req.body;

    var totalPrice = 0.0;
    var db = admin.firestore();

    console.log('userId: ' + userId);

    var snapshot = await db.collection("users").doc(userId).get();
    console.log('name: ' + snapshot.data().name);

    var cartItems = snapshot.data().cart.items;
    for (index = 0; index < cartItems.length; index++) {
        var element = cartItems[index];
        console.log('productDocumentId: ' + element.productDocumentId);
        var snapshot2 = await db.collection("products").doc(element.productDocumentId).get();
        console.log('priceInYen: ' + snapshot2.data().priceInYen);
        console.log(typeof snapshot2.data().priceInYen);
        console.log('quantity: ' + element.stockRequest.quantity);
        console.log(typeof element.stockRequest.quantity);
        totalPrice += snapshot2.data().priceInYen * element.stockRequest.quantity;
    }

    console.log('price: ' + totalPrice);

    const paymentIntent = await stripe.paymentIntents.create({
        amount: totalPrice,
        payment_method: paymentMethodId,
        currency: 'jpy',
        payment_method_types: ['card'],
        confirmation_method: 'automatic',
        confirm: true
    });

    res.json({
        publishableKey: functions.config().stripe.publishable_key,
        clientSecret: paymentIntent.client_secret
    });
});

exports.createPaymentIntent = functions.https.onRequest(app);
