const mongoose = require('mongoose');

const problemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    location: { type: String, required: true },
    imagePath: { type: String, required: false },
    status: { type: String, enum: ['pending', 'processing', 'completed'], default: 'pending' },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Problem', problemSchema);
