const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const stripe = require('stripe')(functions.config().stripe.token);
const express = require('express');
const app = express();
const fcm = admin.messaging();
var db = admin.firestore();

app.post('/create-payment-intent', async (req, res) => {
    const { userId, paymentMethodId } = req.body;

    var totalPrice = 0.0;

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

exports.newOrderPlaced = functions.firestore
    .document('orders/{orderId}')
    .onCreate((snap, context) => {
        const order = snap.data();

        const payload = {
            notification: {
                title: '発注のお知らせ',
                body: order.pushNotificationMessage,
                click_action: 'FLUTTER_NOTIFICATION_CLICK'
            },
            data: {
                orderDocumentId: snap.id
            }
        };
        console.log('Created payload' + payload);

        return db.collection('users').where('role', '==', 0).get().then(querySnapshot => {

            querySnapshot.forEach(doc => {
                var adminUserId = doc.data().email;
                console.log('Got admin: ' + adminUserId);

                db.collection('users').doc(adminUserId).collection('tokens').get().then(querySnapshot1 => {

                    console.log('got tokens for: ' + doc.data().email);

                    let tokens = querySnapshot1.docs.map(qsnap => qsnap.id);

                    for (let index = 0; index < tokens.length; index++) {
                        const element = tokens[index];

                        fcm.sendToDevice(element, payload).then(response => {
                            console.log('Sent notifications for ' + element);
                            return null;
                        }).catch();
                    }

                    return null;
                }).catch();
            })

            return null;
        }).catch();
    });

// Order Status
// 1  pending
// 2  dispatched
// 3  delivered
// 4  cancelledByCustomer
// 5  deletedByAdmin
exports.orderDispatched = functions.firestore
    .document('orders/{orderId}')
    .onUpdate((change, context) => {
        const orderNewValue = change.after.data();
        const orderPreviousValue = change.before.data();
        if (orderPreviousValue.status === 1 && orderNewValue.status === 2) {
            const payload = {
                notification: {
                    title: '注文完了のお知らせ',
                    body: 'ただ今注文を承りました。発送までしばらくお待ちください。',
                    click_action: 'FLUTTER_NOTIFICATION_CLICK'
                }
            };
            console.log('Created payload' + payload);

            // Send notification to customer that their order has been dispatched
            return db.collection('users').doc(orderNewValue.customerId).collection('tokens').get().then(querySnapshot1 => {

                console.log('got tokens for customer: ' + orderNewValue.customerId);

                let tokens = querySnapshot1.docs.map(qsnap => qsnap.id);

                for (let index = 0; index < tokens.length; index++) {
                    const element = tokens[index];

                    fcm.sendToDevice(element, payload).then(response => {
                        console.log('Sent notifications that their order is dispatched for ' + element);
                        return null;
                    }).catch();
                }

                return null;
            }).catch();
        }

        return null;
    });