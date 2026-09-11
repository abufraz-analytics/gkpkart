const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const session = require('express-session');

const Product = require('./models/product');
const Order = require('./models/order');
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

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Connected to MongoDB Atlas successfully!'))
    .catch((err) => console.error('Database connection error:', err));

// Helper: Get 4 Delivery Boys from Environment Variables
const getDeliveryBoys = () => {
    return [
        { id: process.env.DELIVERY_ID_1 || 'del1', pass: process.env.DELIVERY_PASS_1 || 'pass1' },
        { id: process.env.DELIVERY_ID_2 || 'del2', pass: process.env.DELIVERY_PASS_2 || 'pass2' },
        { id: process.env.DELIVERY_ID_3 || 'del3', pass: process.env.DELIVERY_PASS_3 || 'pass3' },
        { id: process.env.DELIVERY_ID_4 || 'del4', pass: process.env.DELIVERY_PASS_4 || 'pass4' }
    ];
};

// Home route with Category filter and Flexible Search functionality
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

// Handle Order Submission with Secret Key Generation
app.post('/order/:id', async (req, res) => {
    try {
        const { customerName, customerPhone, customerAddress } = req.body;
        const productId = req.params.id;
        const product = await Product.findById(productId);

        if (!product) {
            return res.status(404).send('Product not found');
        }

        // Generate a 4-digit random secret key for delivery verification
        const secretKey = Math.floor(1000 + Math.random() * 9000).toString();

        const newOrder = new Order({
            product: productId,
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
                alert('Order Placed Successfully! Save your order info.');
                window.location.href = '/view-orders';
            </script>
        `);
    } catch (err) {
        console.error('Error saving order:', err.message);
        res.status(500).send('Server Error during order placement');
    }
});

// Customer View Orders Page
app.get('/view-orders', async (req, res) => {
    try {
        res.render('customer-orders');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Submit Review & Rating
app.post('/product/:id/reviews', async (req, res) => {
    try {
        const { user, rating, comment } = req.body;
        const product = await Product.findById(req.params.id);

        product.reviews.push({
            user,
            rating: Number(rating),
            comment
        });

        await product.save();
        res.redirect(`/product/${req.params.id}`);
    } catch (err) {
        console.error('Error adding review:', err.message);
        res.status(500).send('Server Error');
    }
});

// ================= ADMIN AUTHENTICATION =================
const isAdminLoggedIn = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    res.redirect('/admin/login');
};

app.get('/admin/login', (req, res) => {
    res.render('admin/login', { error: null });
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        req.session.isAdmin = true;
        res.redirect('/admin/dashboard');
    } else {
        res.render('admin/login', { error: 'Invalid Username or Password!' });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

// ================= DELIVERY BOY AUTHENTICATION =================
const isDeliveryLoggedIn = (req, res, next) => {
    if (req.session && req.session.deliveryBoyId) {
        return next();
    }
    res.redirect('/delivery/login');
};

app.get('/delivery/login', (req, res) => {
    res.render('delivery/login', { error: null });
});

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

app.get('/delivery/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/delivery/login');
    });
});

// Delivery Boy Dashboard Route
app.get('/delivery/dashboard', isDeliveryLoggedIn, async (req, res) => {
    try {
        const deliveryBoyId = req.session.deliveryBoyId;
        const assignedOrders = await Order.find({ 
            deliveryBoyId: deliveryBoyId, 
            orderStatus: 'Out For Delivery' 
        }).populate('product').sort({ createdAt: -1 });

        res.render('delivery/dashboard', { deliveryBoyId, orders: assignedOrders });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Delivery Boy: Submit Secret Key to Complete Delivery
app.post('/delivery/complete-order/:id', isDeliveryLoggedIn, async (req, res) => {
    try {
        const { enteredKey } = req.body;
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).send('Order not found');
        }

        if (order.secretKey === enteredKey.trim()) {
            order.orderStatus = 'Delivered';
            await order.save();
            res.redirect('/delivery/dashboard');
        } else {
            res.send(`
                <script>
                    alert('Invalid Secret Key! Please check with customer.');
                    window.location.href = '/delivery/dashboard';
                </script>
            `);
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// ================= ADMIN DASHBOARD & CATEGORY MANAGEMENT =================
app.get('/admin/dashboard', isAdminLoggedIn, async (req, res) => {
    try {
        const products = await Product.find({}).sort({ createdAt: -1 });
        res.render('admin/dashboard', { products });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Category-Specific Management Page (Manage Products & Orders for a specific category)
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
        const order = await Order.findById(req.params.id);
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
        const { deliveryBoyId, manualSecretCode } = req.body;
        const order = await Order.findById(req.params.id);
        
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
        const { status, cancelReason } = req.body;
        const order = await Order.findById(req.params.id);
        
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
        await Order.findByIdAndDelete(req.params.id);
        res.redirect('back');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// ================= PRODUCT CRUD ROUTES =================

// ADD PRODUCT FORM ROUTE (GET)
app.get('/admin/add-product', isAdminLoggedIn, (req, res) => {
    res.render('admin/add-product');
});

app.post('/admin/add-product', isAdminLoggedIn, upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'videos', maxCount: 5 }
]), async (req, res) => {
    try {
        if (!req.files || !req.files.images || req.files.images.length === 0) {
            return res.status(400).send('Bad Request: At least one product image is required.');
        }

        const imagePaths = req.files.images.map(file => file.path);
        const videoPaths = req.files.videos ? req.files.videos.map(file => file.path) : [];

        const { title, brand, price, description, category, whatsappNumber, returnPolicy } = req.body;
        
        const newProduct = new Product({
            title,
            brand,
            price: price ? Number(price) : 0,
            description,
            category,
            images: imagePaths,
            videos: videoPaths,
            whatsappNumber,
            returnPolicy: returnPolicy || "7 Days Replacement Policy"
        });

        await newProduct.save();
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error('Error adding product:', err);
        res.status(500).send(`Server Error during product upload: ${err.message}`);
    }
});

app.post('/admin/delete-product/:id', isAdminLoggedIn, async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.redirect('back');
    } catch (err) {
        console.error('Error deleting product:', err.message);
        res.status(500).send('Server Error during product deletion');
    }
});

app.get('/admin/edit-product/:id', isAdminLoggedIn, async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.redirect('/admin/dashboard');
        }
        res.render('admin/edit-product', { product });
    } catch (err) {
        console.error('Error fetching product for edit:', err.message);
        res.redirect('/admin/dashboard');
    }
});

app.post('/admin/edit-product/:id', isAdminLoggedIn, upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'videos', maxCount: 5 }
]), async (req, res) => {
    try {
        const { title, brand, price, description, category, whatsappNumber, returnPolicy } = req.body;
        
        const updateData = {
            title,
            brand,
            description,
            category,
            whatsappNumber,
            returnPolicy
        };

        if (price) {
            updateData.price = Number(price);
        }

        if (req.files && req.files.images && req.files.images.length > 0) {
            updateData.images = req.files.images.map(file => file.path);
        }

        if (req.files && req.files.videos && req.files.videos.length > 0) {
            updateData.videos = req.files.videos.map(file => file.path);
        }

        await Product.findByIdAndUpdate(req.params.id, updateData);
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error('Error updating product:', err);
        res.status(500).send(`Server Error during product update: ${err.message}`);
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
