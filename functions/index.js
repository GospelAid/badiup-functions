const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const stripe = require('stripe')(functions.config().stripe.token);
const express = require('express');
const app = express();
const fcm = admin.messaging();
var db = admin.firestore();
const https = require('https');

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

    var shippingCost = totalPrice < 5000 ? 500 : 0;
    totalPrice = totalPrice + shippingCost;

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

// GET /postcodes/{postcode}
// Get address from postcode
app.get('/postcodes/:postcode', async (req, res) => {
    const addressPostcode = req.params.postcode;

    console.log(`Fetching address for given postcode: "${addressPostcode}"`);

    var options = {
        host: 'apis.postcode-jp.com',
        path: `/api/v3/postcodes?apikey=${functions.config().postcode.api_key}&postcode=${addressPostcode}`,
        method: 'GET'
    };

    try {
        let rawData = '';
        https.request(options, function (res1) {
            console.log('STATUS: ' + res1.statusCode);
            console.log('HEADERS: ' + JSON.stringify(res1.headers));
            res1.setEncoding('utf8');
            res1.on('data', function (chunk) {
                console.log('BODY: ' + chunk);
                rawData += chunk;
            });
            res1.on('end', () => {
                return res.status(200).json(rawData);
            })
        }).end();
    } catch (error) {
        console.log('Error getting address for postcode', addressPostcode, error.message);
        return res.sendStatus(500);
    }
});

exports.api = functions.https.onRequest(app);

exports.newOrderPlaced = functions.firestore
    .document('orders/{orderId}')
    .onCreate((snap, context) => {
        const order = snap.data();

        return db.collection('users').where('role', '==', 0).get().then(querySnapshot => {

            querySnapshot.forEach(doc => {
                var adminUserId = doc.data().email;
                console.log('Got admin: ' + adminUserId);

                db.collection('users').doc(adminUserId).collection('tokens').get().then(querySnapshot1 => {

                    console.log('got tokens for: ' + doc.data().email);

                    let tokens = querySnapshot1.docs.map(qsnap => qsnap.id);

                    for (let index = 0; index < tokens.length; index++) {
                        const element = tokens[index];
                        const payload = {
                            notification: {
                                title: '発注のお知らせ',
                                body: order.pushNotificationMessage
                            },
                            data: {
                                orderDocumentId: snap.id
                            },
                            token: element
                        };

                        fcm.send(payload).then(response => {
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
            // Send notification to customer that their order has been dispatched
            return db.collection('users').doc(orderNewValue.customerId).collection('tokens').get().then(querySnapshot1 => {

                console.log('got tokens for customer: ' + orderNewValue.customerId);

                let tokens = querySnapshot1.docs.map(qsnap => qsnap.id);

                for (let index = 0; index < tokens.length; index++) {
                    const element = tokens[index];
                    const payload = {
                        notification: {
                            title: '商品発送のお知らせ',
                            body: '商品を発送しました。到着までしばらくお待ち下さい。'
                        },
                        data: {
                            orderDocumentId: change.after.id
                        },
                        token: element
                    };

                    fcm.send(payload).then(response => {
                        console.log('Sent notifications that their order is dispatched for ' + element);
                        return null;
                    }).catch();
                }

                return null;
            }).catch();
        }

        return null;
    });

exports.newProductPublished = functions.firestore
    .document('products/{productId}')
    .onWrite((change, context) => {
        const product = change.after.exists ? change.after.data() : null;

        if (product === null) {
            console.log('Product does not exist. Exiting...');
            return null;
        }

        if (!product.isPublished) {
            console.log('Product still in draft state. Exiting...');
            return null;
        }

        if (change.before.exists && change.before.data().isPublished) {
            console.log('Product already in published state. Exiting...');
            return null;
        }

        // Send notification to all customers
        return db.collection('users').where('role', '==', 1).get().then(querySnapshot => {

            querySnapshot.forEach(doc => {
                var customerUserId = doc.data().email;
                console.log('Got customer: ' + customerUserId);

                db.collection('users').doc(customerUserId).collection('tokens').get().then(querySnapshot1 => {

                    console.log('got tokens for: ' + doc.data().email);

                    let tokens = querySnapshot1.docs.map(qsnap => qsnap.id);

                    for (let index = 0; index < tokens.length; index++) {
                        const element = tokens[index];
                        const payload = {
                            notification: {
                                title: '新製品のお知らせ',
                                body: product.name + 'が新入荷(^^)/ 詳しくはコチラから♪'
                            },
                            data: {
                                productDocumentId: change.after.id
                            },
                            token: element
                        };

                        fcm.send(payload).then(response => {
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