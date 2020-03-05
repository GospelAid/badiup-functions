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
    var snapshot = db.collection("users").doc(userId).get();
    snapshot.data().cart.items.forEach(element => {
        var snapshot2 = db.collection("products").doc(element.productDocumentId).get();
        totalPrice += snapshot2.data().priceInYen * element.quantity;
    });

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
