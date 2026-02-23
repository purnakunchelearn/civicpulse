const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const { OpenAI } = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://openrouter.ai/api/v1"
});

const User = require('../models/User');
const Admin = require('../models/Admin');
const Problem = require('../models/Problem');

// Multer setup for image uploads
const fs = require('fs');
const uploadDir = path.join(__dirname, '../public/uploads/');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});
const upload = multer({ storage: storage });

// Middleware to check authentication
const requireUserLogin = (req, res, next) => {
    if (req.session.userId) next();
    else res.redirect('/user-login');
};

const requireAdminLogin = (req, res, next) => {
    if (req.session.adminId) next();
    else res.redirect('/admin-login');
};

// --- Landing Page ---
router.get('/', (req, res) => {
    res.render('index');
});

// --- User Routes ---
router.get('/user-register', (req, res) => {
    res.render('user-register', { error: null });
});

router.post('/user-register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.render('user-register', { error: 'Username already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await User.create({ username, password: hashedPassword });
        res.redirect('/user-login');
    } catch (err) {
        res.render('user-register', { error: 'Registration failed' });
    }
});

router.get('/user-login', (req, res) => {
    res.render('user-login', { error: null });
});

router.post('/user-login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user._id;
        res.redirect('/user-dashboard');
    } else {
        res.render('user-login', { error: 'Invalid credentials' });
    }
});

router.get('/user-logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

router.get('/user-dashboard', requireUserLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const problems = await Problem.find({ postedBy: req.session.userId });
    res.render('user-dashboard', { problems, success: req.query.success, user });
});

router.get('/problem/:id', requireUserLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const problem = await Problem.findById(req.params.id).populate('postedBy', 'username');
        if (!problem) return res.status(404).send('Problem not found');
        res.render('user-view-problem', { problem, user });
    } catch (err) {
        res.status(500).send('Error loading problem');
    }
});

router.get('/post-problem', requireUserLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('post-problem', { user });
});

router.post('/post-problem', requireUserLogin, upload.single('image'), async (req, res) => {
    try {
        const { name: manualName, description: manualDescription, location } = req.body;

        if (!req.file) {
            return res.status(400).send("An image is required to post a problem.");
        }

        const imagePath = `/uploads/${req.file.filename}`;
        const localImagePath = req.file.path;

        // Just save to DB with whatever the user provided (can be auto-generated from frontend or typed manually)
        let finalName = manualName || "Reported Issue";
        let finalDescription = manualDescription || "Description unavailable";

        // 4. Save to DB
        await Problem.create({
            name: finalName,
            description: finalDescription,
            location,
            imagePath,
            postedBy: req.session.userId
        });

        res.redirect('/user-dashboard?success=1');
    } catch (err) {
        console.error("Error creating problem:", err);
        res.status(500).send("Error creating problem: " + err.message);
    }
});

router.post('/api/generate-description', requireUserLogin, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "An image is required to generate a description." });
        }

        const localImagePath = req.file.path;
        const imageBase64 = fs.readFileSync(localImagePath).toString("base64");

        const prompt = `Analyze this image of a public problem (like a pothole, broken street light, trash, etc). Provide two things separated by a pipe character (|): 
1. A very short title (max 5 words)
2. A short description (exactly exactly 20 words or less).
Format: Title | Description.`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: `data:${req.file.mimetype};base64,${imageBase64}` } }
                    ]
                }
            ],
            max_tokens: 150
        });

        const text = response.choices[0].message.content || "Unknown Problem | Need more details";
        const parts = text.split('|').map(s => s.trim());

        res.json({
            name: parts[0] ? parts[0].replace(/\*/g, '').trim() : "Reported Issue",
            description: parts[1] ? parts[1].replace(/\*/g, '').trim() : "Description unavailable."
        });

        // Cleanup temp file uploaded for just generation
        try { fs.unlinkSync(localImagePath); } catch (e) { }
    } catch (err) {
        console.error("OpenAI Generation Error Details:", err);
        const errorMessage = err.response?.data?.error?.message || err.message || "Unknown error";
        res.status(500).json({ error: `OpenAI Error: ${errorMessage}. Please check your key and quota.` });
    }
});

// --- Admin Routes ---
router.get('/admin-login', (req, res) => {
    res.render('admin-login', { error: null });
});

router.post('/admin-login', async (req, res) => {
    const { username, password } = req.body;
    // For demo: create first admin if not exists
    let admin = await Admin.findOne({ username });
    if (!admin) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        admin = await Admin.create({ username: 'admin', password: hashedPassword });
    }

    if (admin && await bcrypt.compare(password, admin.password)) {
        req.session.adminId = admin._id;
        res.redirect('/admin-dashboard');
    } else {
        res.render('admin-login', { error: 'Invalid admin credentials' });
    }
});

router.get('/admin-logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

router.get('/admin-dashboard', requireAdminLogin, async (req, res) => {
    const { status, date, sortBy, order } = req.query;
    const query = {};

    if (status && status !== 'all') {
        query.status = status;
    }

    if (date) {
        const selectedDate = new Date(date);
        const startOfDay = new Date(selectedDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(selectedDate.setHours(23, 59, 59, 999));
        query.createdAt = { $gte: startOfDay, $lte: endOfDay };
    }

    // Sorting logic
    let sortObj = { createdAt: -1 }; // Default: Newest first
    if (sortBy) {
        sortObj = { [sortBy]: order === 'asc' ? 1 : -1 };
    }

    const problems = await Problem.find(query).populate('postedBy', 'username').sort(sortObj);
    res.render('admin-dashboard', {
        problems,
        filters: { status, date, sortBy, order }
    });
});

router.get('/admin/problem/:id', requireAdminLogin, async (req, res) => {
    try {
        const problem = await Problem.findById(req.params.id).populate('postedBy', 'username');
        if (!problem) return res.status(404).send('Problem not found');
        res.render('admin-view-problem', { problem });
    } catch (err) {
        res.status(500).send('Error loading problem');
    }
});

router.post('/update-status/:id', requireAdminLogin, async (req, res) => {
    const { status } = req.body;
    await Problem.findByIdAndUpdate(req.params.id, { status });

    if (req.query.redirect === 'view') {
        res.redirect(`/admin/problem/${req.params.id}`);
    } else {
        res.redirect('/admin-dashboard');
    }
});

module.exports = router;
