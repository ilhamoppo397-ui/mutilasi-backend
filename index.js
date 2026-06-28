const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');
const multer = require('multer');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mutilasi_food'
});

db.connect((err) => {
    if (err) {
        console.log('❌ Database error:', err.message);
    } else {
        console.log('✅ Database connected');
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Mutilasi Food API Running' });
});

app.get('/api/menu', (req, res) => {
    db.query('SELECT m.*, c.name as category_name FROM menu m LEFT JOIN categories c ON m.category_id = c.id WHERE m.is_available = 1', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, data: results });
    });
});

app.get('/api/menu/:id', (req, res) => {
    db.query('SELECT m.*, c.name as category_name FROM menu m LEFT JOIN categories c ON m.category_id = c.id WHERE m.id = ?', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(404).json({ success: false, message: 'Menu not found' });
        res.json({ success: true, data: results[0] });
    });
});

app.get('/api/categories', (req, res) => {
    db.query('SELECT * FROM categories WHERE is_active = 1', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, data: results });
    });
});

// ========== ORDERS ==========
app.get('/api/orders', (req, res) => {
    db.query('SELECT o.*, u.full_name as user_name FROM orders o LEFT JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, data: results });
    });
});

app.post('/api/orders', (req, res) => {
    const { customer_name, customer_phone, customer_address, order_type, items, final_amount, notes } = req.body;
    const orderNumber = 'ORD-' + Date.now();
    const total_amount = final_amount;

    const sql = 'INSERT INTO orders (order_number, customer_name, customer_phone, customer_address, order_type, total_amount, final_amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    db.query(sql, [orderNumber, customer_name, customer_phone, customer_address, order_type, total_amount, final_amount, notes], (err, result) => {
        if (err) {
            console.error('Order insert error:', err);
            return res.status(500).json({ error: err.message });
        }

        const orderId = result.insertId;

        if (items && items.length > 0) {
            // Ambil nama menu dari database
            const menuIds = items.map(item => item.menu_id);
            const menuSql = 'SELECT id, name FROM menu WHERE id IN (?)';
            db.query(menuSql, [menuIds], (err, menuResults) => {
                if (err) {
                    console.error('Menu fetch error:', err);
                    return res.status(500).json({ error: err.message });
                }

                const menuMap = {};
                menuResults.forEach(row => {
                    menuMap[row.id] = row.name;
                });

                const itemValues = items.map(item => {
                    const menuName = menuMap[item.menu_id] || 'Menu';
                    return [orderId, item.menu_id, menuName, item.quantity, item.price, item.subtotal];
                });

                const itemSql = 'INSERT INTO order_items (order_id, menu_id, menu_name, quantity, price, subtotal) VALUES ?';
                db.query(itemSql, [itemValues], (err2) => {
                    if (err2) {
                        console.error('Order items insert error:', err2);
                        return res.status(500).json({ error: err2.message });
                    }
                    res.json({ success: true, order_id: orderId, order_number: orderNumber });
                });
            });
        } else {
            res.json({ success: true, order_id: orderId, order_number: orderNumber });
        }
    });
});

app.put('/api/orders/:id/status', (req, res) => {
    const { status } = req.body;
    const sql = 'UPDATE orders SET status = ? WHERE id = ?';
    db.query(sql, [status, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ========== AUTH ==========
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email dan password wajib diisi' });
    }

    const sql = 'SELECT * FROM users WHERE email = ?';
    db.query(sql, [email], async (err, results) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        if (results.length === 0) {
            return res.status(401).json({ success: false, message: 'Email tidak ditemukan' });
        }

        const user = results[0];

        try {
            const isValid = await bcrypt.compare(password, user.password_hash || '');
            if (!isValid) {
                return res.status(401).json({ success: false, message: 'Password salah' });
            }

            delete user.password_hash;
            res.json({
                success: true,
                message: 'Login berhasil',
                user: user,
                token: 'dummy-token-' + Date.now()
            });
        } catch (err) {
            res.status(500).json({ success: false, message: 'Terjadi kesalahan' });
        }
    });
});

app.post('/api/auth/register', async (req, res) => {
    const { full_name, email, phone, password } = req.body;

    if (!full_name || !email || !phone || !password) {
        return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = 'INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)';

        db.query(sql, [full_name, email, phone, hashedPassword, 'customer'], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ success: false, message: 'Email atau phone sudah terdaftar' });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, message: 'Registrasi berhasil', user_id: result.insertId });
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/forgot-password', (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: 'Email wajib diisi' });
    }

    const sql = 'SELECT * FROM users WHERE email = ?';
    db.query(sql, [email], (err, results) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Email tidak ditemukan' });
        }

        const resetToken = 'reset-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10);
        
        res.json({
            success: true,
            message: 'Link reset password telah dikirim ke email Anda',
            resetToken: resetToken
        });
    });
});

// ========== ADMIN MENU ==========
app.post('/api/admin/menu', (req, res) => {
    const { name, price, description, stock } = req.body;
    const sql = 'INSERT INTO menu (name, price, description, stock, is_available) VALUES (?, ?, ?, ?, 1)';
    db.query(sql, [name, price, description, stock || 0], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: result.insertId });
    });
});

app.put('/api/admin/menu/:id', (req, res) => {
    const { name, price, description, stock, is_available } = req.body;
    const sql = 'UPDATE menu SET name = ?, price = ?, description = ?, stock = ?, is_available = ? WHERE id = ?';
    db.query(sql, [name, price, description, stock, is_available, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/admin/menu/:id', (req, res) => {
    db.query('DELETE FROM menu WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ========== UPLOAD GAMBAR ==========
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function(req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif|webp/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Hanya file gambar yang diperbolehkan'));
    }
});

app.post('/api/admin/menu/upload/:id', upload.single('image'), (req, res) => {
    const { id } = req.params;
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Tidak ada file yang diupload' });
    }
    
    const imageUrl = '/uploads/' + req.file.filename;
    const sql = 'UPDATE menu SET image_url = ? WHERE id = ?';
    db.query(sql, [imageUrl, id], function(err) {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, imageUrl: imageUrl });
    });
});

// ========== USERS ==========
app.get('/api/users', (req, res) => {
    db.query('SELECT id, full_name, email, phone, role, points, is_active, created_at FROM users ORDER BY created_at DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, data: results });
    });
});

// ========== START SERVER ==========
app.listen(PORT, function() {
    console.log('🚀 Server on http://localhost:' + PORT);
    console.log('📡 API ready');
    console.log('🖼️  Static files served from /uploads');
});
