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

// Home route with Flexible Search functionality (Partial & single word match)
app.get('/', async (req, res) => {
    try {
        let searchQuery = req.query.search ? req.query.search.trim() : '';
        let query = {};

        if (searchQuery) {
            // Flexible regex match for any single word or partial word
            const searchRegex = new RegExp(searchQuery, 'i');
            query = {
                $or: [
                    { title: searchRegex },
                    { brand: searchRegex },
                    { description: searchRegex }
                ]
            };
        }

        const products = await Product.find(query);
        res.render('index', { products, searchQuery });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Single Product Detail page
app.get('/product/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        
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

// Handle Order Submission from Product Detail Page
app.post('/order/:id', async (req, res) => {
    try {
        const { customerName, customerPhone, customerAddress } = req.body;
        const productId = req.params.id;

        // Create new order
        const newOrder = new Order({
            product: productId,
            customerName,
            phone: customerPhone,
            location: customerAddress
        });

        await newOrder.save();
        
        // Redirect back or to a success message / homepage with alert style
        res.redirect('/');
    } catch (err) {
        console.error('Error saving order:', err);
        res.status(500).send('Server Error during order placement');
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
        console.error('Error adding review:', err);
        res.status(500).send('Server Error');
    }
});

// Admin Protection Middleware
const isAdminLoggedIn = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    res.redirect('/admin/login');
};

// Admin Login Route (GET)
app.get('/admin/login', (req, res) => {
    res.render('admin/login', { error: null });
});

// Admin Login Processing (POST)
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        req.session.isAdmin = true;
        res.redirect('/admin/dashboard');
    } else {
        res.render('admin/login', { error: 'Invalid Username or Password!' });
    }
});

// Admin Dashboard Route (GET) - Now fetches orders with product details
app.get('/admin/dashboard', isAdminLoggedIn, async (req, res) => {
    try {
        const orders = await Order.find({}).populate('product').sort({ createdAt: -1 });
        res.render('admin/dashboard', { orders });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Admin Logout Route
app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

app.get('/admin/add-product', (req, res) => {
    res.redirect('/admin/dashboard');
});

// Add Product Processing (POST)
app.post('/admin/add-product', upload.single('image'), async (req, res) => {
    try {
        const { title, brand, price, description, whatsappNumber, returnPolicy } = req.body;
        
        const newProduct = new Product({
            title,
            brand,
            price,
            description,
            image: req.file.path, 
            whatsappNumber,
            returnPolicy: returnPolicy || "7 Days Replacement Policy"
        });

        await newProduct.save();
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error('Error adding product:', err);
        res.status(500).send('Server Error during product upload');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
