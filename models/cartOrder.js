const mongoose = require('mongoose');

const cartOrderSchema = new mongoose.Schema({
    items: [{
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product'
        },
        title: String,
        price: Number,
        quantity: {
            type: Number,
            default: 1
        },
        image: String
    }],
    totalAmount: {
        type: Number,
        required: true
    },
    customerName: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    location: {
        type: String,
        required: true
    },
    orderStatus: {
        type: String,
        enum: ['New', 'Packed', 'Out For Delivery', 'Delivered', 'Canceled'],
        default: 'New'
    },
    deliveryBoyId: {
        type: String,
        default: null
    },
    secretKey: {
        type: String,
        required: true
    },
    cancelReason: {
        type: String,
        default: ''
    }
}, { timestamps: true });

module.exports = mongoose.model('CartOrder', cartOrderSchema);
