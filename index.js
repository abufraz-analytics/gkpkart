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

// Handle Order Submission from Product Detail Page with Success Popup Alert
app.post('/order/:id', async (req, res) => {
    try {
        const { customerName, customerPhone, customerAddress } = req.body;
        const productId = req.params.id;

        const newOrder = new Order({
            product: productId,
            customerName,
            phone: customerPhone,
            location: customerAddress
        });

        await newOrder.save();
        
        res.send(`
            <script>
                alert('Order Submitted Successfully!');
                window.location.href = '/';
            </script>
        `);
    } catch (err) {
        console.error('Error saving order:', err.message);
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
        console.error('Error adding review:', err.message);
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

// Admin Dashboard Route (GET) - Fetches orders and products for management
app.get('/admin/dashboard', isAdminLoggedIn, async (req, res) => {
    try {
        const orders = await Order.find({}).populate('product').sort({ createdAt: -1 });
        const products = await Product.find({}).sort({ createdAt: -1 });
        res.render('admin/dashboard', { orders, products });
    } catch (err) {
        console.error(err.message);
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

// Add Product Processing (POST) with Multiple Images & Videos Support
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

        const { title, brand, price, description, whatsappNumber, returnPolicy } = req.body;
        
        const newProduct = new Product({
            title,
            brand,
            price,
            description,
            images: imagePaths,
            videos: videoPaths,
            whatsappNumber,
            returnPolicy: returnPolicy || "7 Days Replacement Policy"
        });

        await newProduct.save();
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error('Error adding product:', err.message);
        res.status(500).send(`Server Error during product upload: ${err.message}`);
    }
});

// --- ADMIN EDIT & DELETE ROUTES ---

// 1. Delete Product Route (Changed from GET to POST)
app.post('/admin/delete-product/:id', isAdminLoggedIn, async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error('Error deleting product:', err.message);
        res.status(500).send('Server Error during product deletion');
    }
});

// 2. Edit Product Route (GET Form)
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

// 3. Edit Product Route (POST Update)
app.post('/admin/edit-product/:id', isAdminLoggedIn, upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'videos', maxCount: 5 }
]), async (req, res) => {
    try {
        const { title, brand, price, description, whatsappNumber, returnPolicy } = req.body;
        
        const updateData = {
            title,
            brand,
            price: Number(price),
            description,
            whatsappNumber,
            returnPolicy
        };

        // If new images are uploaded, update the images array
        if (req.files && req.files.images && req.files.images.length > 0) {
            updateData.images = req.files.images.map(file => file.path);
        }

        // If new videos are uploaded, update the videos array
        if (req.files && req.files.videos && req.files.videos.length > 0) {
            updateData.videos = req.files.videos.map(file => file.path);
        }

        await Product.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error('Error updating product:', err.message);
        res.status(500).send(`Server Error during product update: ${err.message}`);
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
