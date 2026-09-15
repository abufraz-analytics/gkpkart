const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const session = require('express-session');

const Product = require('./models/product');
const Order = require('./models/order');
const CartOrder = require('./models/cartOrder');
const { upload } = require('./utils/cloudinary');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.use(express.static('public'));

app.use(session({
    secret: 'gkpkart_secure_secret_key',
    resave: false,
    saveUninitialized: false
}));

// Global middleware for cart fallback
app.use((req, res, next) => {
    res.locals.cart = req.session.cart || { items: [], totalQty: 0, totalPrice: 0 };
    next();
});

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Connected to MongoDB Atlas successfully!'))
    .catch((err) => console.error('Database connection error:', err));

// Helper: Get Delivery Boys
const getDeliveryBoys = () => {
    return [
        { id: process.env.DELIVERY_ID_1 || 'del1', pass: process.env.DELIVERY_PASS_1 || 'pass1' },
        { id: process.env.DELIVERY_ID_2 || 'del2', pass: process.env.DELIVERY_PASS_2 || 'pass2' },
        { id: process.env.DELIVERY_ID_3 || 'del3', pass: process.env.DELIVERY_PASS_3 || 'pass3' },
        { id: process.env.DELIVERY_ID_4 || 'del4', pass: process.env.DELIVERY_PASS_4 || 'pass4' }
    ];
};

// Home route
app.get('/', async (req, res) => {
    try {
        let searchQuery = req.query.search ? req.query.search.trim() : '';
        let selectedCategory = req.query.category ? req.query.category.trim() : '';
        let query = {};

        if (selectedCategory) {
            query.category = selectedCategory;
        }

        if (searchQuery) {
            const searchRegex = new RegExp(searchQuery, 'i');
            query.$or = [
                { title: searchRegex },
                { brand: searchRegex },
                { description: searchRegex }
            ];
        }

        const products = await Product.find(query).sort({ createdAt: -1 });
        res.render('index', { products, searchQuery, selectedCategory });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Single Product Detail page
app.get('/product/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.redirect('/');
        }

        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.redirect('/');
        }

        let averageRating = 0;
        if (product.reviews && product.reviews.length > 0) {
            let sum = product.reviews.reduce((acc, review) => acc + review.rating, 0);
            averageRating = (sum / product.reviews.length).toFixed(1);
        }

        res.render('product-detail', { product, averageRating });
    } catch (err) {
        console.error('Error fetching product details:', err);
        res.redirect('/');
    }
});

// ================= CART MANAGEMENT & CHECKOUT ROUTES =================
const addToCartHandler = async (req, res) => {
    try {
        const productId = req.params.id;
        if (productId === 'back') return res.redirect('/');
        
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).send('Invalid Product ID');
        }

        const product = await Product.findById(productId);
        if (!product) return res.status(404).send('Product not found');

        if (!req.session.cart) {
            req.session.cart = { items: [], totalQty: 0, totalPrice: 0 };
        }

        let cart = req.session.cart;
        let existingItem = cart.items.find(item => (item.productId && item.productId.toString() === productId) || (item.id === productId));

        if (existingItem) {
            existingItem.quantity = (existingItem.quantity || existingItem.qty || 1) + 1;
            existingItem.qty = existingItem.quantity;
        } else {
            cart.items.push({
                productId: product._id,
                id: product._id.toString(),
                title: product.title,
                price: product.price,
                image: product.images && product.images.length > 0 ? product.images[0] : '',
                quantity: 1,
                qty: 1
            });
        }

        cart.totalQty = cart.items.reduce((sum, item) => sum + (item.quantity || item.qty || 1), 0);
        cart.totalPrice = cart.items.reduce((sum, item) => sum + (item.price * (item.quantity || item.qty || 1)), 0);

        res.redirect(req.get('Referer') || '/');
    } catch (err) {
        console.error('Error adding to cart:', err);
        res.status(500).send('Server Error during adding to cart');
    }
};

app.post('/cart/add/:id', addToCartHandler);
app.get('/cart/add/:id', addToCartHandler);

app.get('/checkout', (req, res) => {
    try {
        res.render('checkout', { cart: req.session.cart || { items: [], totalQty: 0, totalPrice: 0 } });
    } catch (err) {
        console.error('Error opening checkout:', err);
        res.redirect('/');
    }
});

// ✅ 1. CART ORDER ROUTE (FIX: Isko pehle add kiya hai taaki /order/:id isko interfere na kare)
app.post('/order/cart', async (req, res) => {
    try {
        const { customerName, customerPhone, customerAddress, items, totalAmount } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, error: 'No items in cart order' });
        }

        const formattedItems = items.map(item => ({
            product: (item.productId && mongoose.Types.ObjectId.isValid(item.productId)) ? item.productId : null,
            title: item.title || 'Product',
            price: Number(item.price) || 0,
            quantity: Number(item.quantity || item.qty) || 1,
            image: item.image || ''
        }));

        const secretKey = Math.floor(1000 + Math.random() * 9000).toString();

        const newCartOrder = new CartOrder({
            items: formattedItems,
            totalAmount: Number(totalAmount),
            customerName,
            phone: customerPhone,
            location: customerAddress,
            orderStatus: 'New',
            secretKey: secretKey
        });

        await newCartOrder.save();

        if (req.session.cart) {
            req.session.cart = { items: [], totalQty: 0, totalPrice: 0 };
        }

        res.json({ success: true, secretKey: secretKey, orderId: newCartOrder._id });
    } catch (err) {
        console.error('Error saving cart order:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ✅ 2. SINGLE DIRECT PRODUCT ORDER ROUTE (Saves to Order Model)
app.post('/order/:id', async (req, res) => {
    try {
        const { customerName, customerPhone, customerAddress } = req.body;
        const productId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).send('Invalid Product ID');
        }

        const product = await Product.findById(productId);
        if (!product) return res.status(404).send('Product not found');

        const secretKey = Math.floor(1000 + Math.random() * 9000).toString();

        const newOrder = new Order({
            product: product._id,
            items: [{
                product: product._id,
                title: product.title,
                price: product.price,
                quantity: 1,
                image: product.images && product.images.length > 0 ? product.images[0] : ''
            }],
            totalAmount: product.price,
            customerName,
            phone: customerPhone,
            location: customerAddress,
            category: product.category,
            orderStatus: 'New',
            secretKey: secretKey
        });

        await newOrder.save();

        res.send(`
            <script>
                let savedOrdersData = JSON.parse(localStorage.getItem('gkp_my_orders_with_time') || '[]');
                savedOrdersData.push({ id: "${newOrder._id}", completedAt: null, isCart: false });
                localStorage.setItem('gkp_my_orders_with_time', JSON.stringify(savedOrdersData));
                alert('Order Placed Successfully! Secret Code: ${secretKey}');
                window.location.href = '/view-orders';
            </script>
        `);
    } catch (err) {
        console.error('Error saving direct order:', err);
        res.status(500).send('Server Error during order placement');
    }
});

app.get('/view-orders', async (req, res) => {
    try {
        res.render('customer-orders', { cart: null });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// API Route to Fetch Orders
app.post('/api/customer-orders', async (req, res) => {
    try {
        const { orderIds } = req.body;
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return res.json([]);
        }

        const validObjectIds = orderIds.filter(id => mongoose.Types.ObjectId.isValid(id));

        const normalOrders = await Order.find({ _id: { $in: validObjectIds } }).populate('product').lean();
        const cartOrders = await CartOrder.find({ _id: { $in: validObjectIds } }).lean();

        const taggedCartOrders = cartOrders.map(o => ({ ...o, isCartOrder: true }));

        const allOrders = [...normalOrders, ...taggedCartOrders];
        allOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json(allOrders);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Reviews Route
app.post('/product/:id/reviews', async (req, res) => {
    try {
        const { user, rating, comment } = req.body;
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).send('Invalid Product ID');
        }

        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).send('Product not found');

        product.reviews.push({ user, rating: Number(rating), comment });
        await product.save();
        res.redirect(`/product/${req.params.id}`);
    } catch (err) {
        console.error('Error adding review:', err.message);
        res.status(500).send('Server Error');
    }
});

// ================= AUTHENTICATION =================
const isAdminLoggedIn = (req, res, next) => {
    if (req.session && req.session.isAdmin) return next();
    res.redirect('/admin/login');
};

app.get('/admin/login', (req, res) => res.render('admin/login', { error: null }));

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        req.session.isAdmin = true;
        res.redirect('/admin/dashboard');
    } else {
        res.render('admin/login', { error: 'Invalid Username or Password!' });
    }
});

app.get('/admin/logout', (req, res) => req.session.destroy(() => res.redirect('/admin/login')));

const isDeliveryLoggedIn = (req, res, next) => {
    if (req.session && req.session.deliveryBoyId) return next();
    res.redirect('/delivery/login');
};

app.get('/delivery/login', (req, res) => res.render('delivery/login', { error: null }));

app.post('/delivery/login', (req, res) => {
    const { deliveryId, password } = req.body;
    const deliveryBoys = getDeliveryBoys();
    const matchedBoy = deliveryBoys.find(b => b.id === deliveryId && b.pass === password);

    if (matchedBoy) {
        req.session.deliveryBoyId = matchedBoy.id;
        res.redirect('/delivery/dashboard');
    } else {
        res.render('delivery/login', { error: 'Invalid Delivery ID or Password!' });
    }
});

app.get('/delivery/logout', (req, res) => req.session.destroy(() => res.redirect('/delivery/login')));

app.get('/delivery/dashboard', isDeliveryLoggedIn, async (req, res) => {
    try {
        const deliveryBoyId = req.session.deliveryBoyId;
        const assignedNormalOrders = await Order.find({ deliveryBoyId, orderStatus: 'Out For Delivery' }).populate('product').lean();
        const assignedCartOrders = await CartOrder.find({ deliveryBoyId, orderStatus: 'Out For Delivery' }).lean();

        const orders = [...assignedNormalOrders, ...assignedCartOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.render('delivery/dashboard', { deliveryBoyId, orders });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.post('/delivery/complete-order/:id', isDeliveryLoggedIn, async (req, res) => {
    try {
        const { enteredKey } = req.body;
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).send('Invalid Order ID');
        }

        let order = await Order.findById(req.params.id);
        if (!order) {
            order = await CartOrder.findById(req.params.id);
        }

        if (!order) return res.status(404).send('Order not found');

        if (order.secretKey === enteredKey.trim()) {
            order.orderStatus = 'Delivered';
            await order.save();
            res.redirect('/delivery/dashboard');
        } else {
            res.send(`<script>alert('Invalid Secret Key!'); window.location.href = '/delivery/dashboard';</script>`);
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// ================= ADMIN DASHBOARD & MANAGEMENT =================
app.get('/admin/dashboard', isAdminLoggedIn, async (req, res) => {
    try {
        const products = await Product.find({}).sort({ createdAt: -1 });
        res.render('admin/dashboard', { products });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Multi-Item Orders Route
app.get('/admin/orders/multi-item', isAdminLoggedIn, async (req, res) => {
    try {
        const categoryName = 'Multi-Item Orders (Cart)';

        const newOrders = await CartOrder.find({ orderStatus: 'New' }).sort({ createdAt: -1 });
        const packedOrders = await CartOrder.find({ orderStatus: 'Packed' }).sort({ createdAt: -1 });
        const outForDeliveryOrders = await CartOrder.find({ orderStatus: 'Out For Delivery' }).sort({ createdAt: -1 });
        const deliveredOrders = await CartOrder.find({ orderStatus: 'Delivered' }).sort({ createdAt: -1 });
        const canceledOrders = await CartOrder.find({ orderStatus: 'Canceled' }).sort({ createdAt: -1 });

        res.render('admin/category-management', {
            categoryName,
            products: [],
            newOrders,
            packedOrders,
            outForDeliveryOrders,
            deliveredOrders,
            canceledOrders,
            deliveryBoys: getDeliveryBoys()
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Category Specific Orders
app.get('/admin/category/:categoryName', isAdminLoggedIn, async (req, res) => {
    try {
        const categoryName = req.params.categoryName;
        const products = await Product.find({ category: categoryName }).sort({ createdAt: -1 });
        
        const newOrders = await Order.find({ category: categoryName, orderStatus: 'New' }).populate('product').sort({ createdAt: -1 });
        const packedOrders = await Order.find({ category: categoryName, orderStatus: 'Packed' }).populate('product').sort({ createdAt: -1 });
        const outForDeliveryOrders = await Order.find({ category: categoryName, orderStatus: 'Out For Delivery' }).populate('product').sort({ createdAt: -1 });
        const deliveredOrders = await Order.find({ category: categoryName, orderStatus: 'Delivered' }).populate('product').sort({ createdAt: -1 });
        const canceledOrders = await Order.find({ category: categoryName, orderStatus: 'Canceled' }).populate('product').sort({ createdAt: -1 });

        res.render('admin/category-management', {
            categoryName,
            products,
            newOrders,
            packedOrders,
            outForDeliveryOrders,
            deliveredOrders,
            canceledOrders,
            deliveryBoys: getDeliveryBoys()
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// ================= ORDER LIFECYCLE ACTIONS (ADMIN) =================
app.post('/admin/order/pack/:id', isAdminLoggedIn, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.redirect('back');

        let order = await Order.findById(req.params.id);
        if (!order) order = await CartOrder.findById(req.params.id);

        if (order) {
            order.orderStatus = 'Packed';
            await order.save();
        }
        res.redirect('back');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.post('/admin/order/dispatch/:id', isAdminLoggedIn, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.redirect('back');

        const { deliveryBoyId, manualSecretCode } = req.body;
        let order = await Order.findById(req.params.id);
        if (!order) order = await CartOrder.findById(req.params.id);
        
        if (order) {
            order.deliveryBoyId = deliveryBoyId;
            if (manualSecretCode && manualSecretCode.trim() !== '') {
                order.secretKey = manualSecretCode.trim();
            }
            order.orderStatus = 'Out For Delivery';
            await order.save();
        }
        res.redirect('back');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.post('/admin/order/status/:id', isAdminLoggedIn, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.redirect('back');

        const { status, cancelReason } = req.body;
        let order = await Order.findById(req.params.id);
        if (!order) order = await CartOrder.findById(req.params.id);
        
        if (order) {
            order.orderStatus = status;
            if (status === 'Canceled' && cancelReason) {
                order.cancelReason = cancelReason;
            }
            await order.save();
        }
        res.redirect('back');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.post('/admin/order/delete/:id', isAdminLoggedIn, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.redirect('back');

        let deleted = await Order.findByIdAndDelete(req.params.id);
        if (!deleted) await CartOrder.findByIdAndDelete(req.params.id);
        res.redirect('back');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// ================= PRODUCT CRUD ROUTES =================
app.get('/admin/add-product', isAdminLoggedIn, (req, res) => res.render('admin/add-product'));

app.post('/admin/add-product', isAdminLoggedIn, upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'videos', maxCount: 5 }
]), async (req, res) => {
    try {
        if (!req.files || !req.files.images || req.files.images.length === 0) {
            return res.status(400).send('At least one product image is required.');
        }

        const imagePaths = req.files.images.map(file => file.path);
        const videoPaths = req.files.videos ? req.files.videos.map(file => file.path) : [];

        const { title, brand, price, description, category, whatsappNumber, returnPolicy } = req.body;
        
        const newProduct = new Product({
            title, brand, price: price ? Number(price) : 0, description, category,
            images: imagePaths, videos: videoPaths, whatsappNumber, returnPolicy: returnPolicy || "7 Days Replacement Policy"
        });

        await newProduct.save();
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send(`Server Error: ${err.message}`);
    }
});

app.post('/admin/delete-product/:id', isAdminLoggedIn, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.redirect('back');

        await Product.findByIdAndDelete(req.params.id);
        res.redirect('back');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.get('/admin/products', isAdminLoggedIn, async (req, res) => {
    try {
        let searchQuery = req.query.search ? req.query.search.trim() : '';
        let query = {};

        if (searchQuery) {
            const searchRegex = new RegExp(searchQuery, 'i');
            query.$or = [{ title: searchRegex }, { brand: searchRegex }, { description: searchRegex }];
        }

        const products = await Product.find(query).sort({ createdAt: -1 });
        res.render('admin/edit-product', { products, searchQuery });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.get('/admin/edit-product/:id', isAdminLoggedIn, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.redirect('/admin/dashboard');

        const product = await Product.findById(req.params.id);
        if (!product) return res.redirect('/admin/dashboard');
        res.render('admin/edit-product-form', { product });
    } catch (err) {
        console.error(err);
        res.redirect('/admin/dashboard');
    }
});

app.post('/admin/edit-product/:id', isAdminLoggedIn, upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'videos', maxCount: 5 }
]), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.redirect('/admin/dashboard');

        const { title, brand, price, description, category, whatsappNumber, returnPolicy } = req.body;
        const updateData = { title, brand, description, category, whatsappNumber, returnPolicy };

        if (price) updateData.price = Number(price);
        if (req.files && req.files.images && req.files.images.length > 0) updateData.images = req.files.images.map(file => file.path);
        if (req.files && req.files.videos && req.files.videos.length > 0) updateData.videos = req.files.videos.map(file => file.path);

        await Product.findByIdAndUpdate(req.params.id, updateData);
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send(`Server Error: ${err.message}`);
    }
});

app.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT}`));
