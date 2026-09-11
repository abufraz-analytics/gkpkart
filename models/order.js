const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
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
        required: true // Delivery location / address
    },
    // Order status fields for the 5-stage lifecycle
    orderStatus: {
        type: String,
        enum: ['New', 'Packed', 'Out For Delivery', 'Delivered', 'Canceled'],
        default: 'New'
    },
    // Category field to match product category for admin management
    category: {
        type: String,
        required: true
    },
    // Assigned Delivery Boy ID (from Render environment variables)
    deliveryBoyId: {
        type: String,
        default: ''
    },
    // Secret key for delivery verification
    secretKey: {
        type: String,
        required: true
    },
    // Reason if the order is canceled
    cancelReason: {
        type: String,
        default: ''
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Order', orderSchema);
