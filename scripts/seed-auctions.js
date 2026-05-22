/**
 * Seed script to populate auctions collection with realistic test data
 * Usage: node scripts/seed-auctions.js
 * Or with environment variables: MONGO_URI=mongodb://... BATCH_SIZE=100 node scripts/seed-auctions.js
 */

const mongoose = require('mongoose');

const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ubuy_loadtest';
const batchSize = parseInt(process.env.BATCH_SIZE || '500', 10);

// Auction schema definition matching src/modules/auctions/schemas/auction.schema.ts
const auctionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,
    images: [String],
    startingPrice: { type: Number, required: true },
    currentPrice: { type: Number, required: true },
    status: { type: String, enum: ['ACTIVE', 'ENDED', 'CANCELLED'], default: 'ACTIVE' },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    category: String,
    createdBy: { type: String, required: true },
    highestBidder: String,
    winner: String,
    notified: { type: Boolean, default: false },
    paymentStatus: { type: String, enum: ['PAID', 'ACTIVE'], default: 'ACTIVE' },
    paymentDueAt: Date,
    winnerHistory: [
      {
        userId: { type: String, required: true },
        amount: { type: Number, required: true },
        reason: { type: String, required: true },
        changedAt: { type: Date, required: true },
      },
    ],
  },
  { timestamps: true }
);

// Create indexes
auctionSchema.index({ status: 1 });
auctionSchema.index({ endTime: 1 });
auctionSchema.index({ category: 1 });
auctionSchema.index({ createdAt: -1 });
auctionSchema.index({ status: 1, createdAt: -1 });
auctionSchema.index({ category: 1, endTime: -1 });
auctionSchema.index({ createdBy: 1, createdAt: -1 });
auctionSchema.index({ winner: 1, paymentStatus: 1 });
auctionSchema.index({ paymentDueAt: 1 });
auctionSchema.index({ status: 1, paymentStatus: 1, paymentDueAt: 1 });

const Auction = mongoose.model('Auction', auctionSchema);

const CATEGORIES = ['Electronics', 'Furniture', 'Collectibles', 'Art', 'Jewelry', 'Books', 'Clothing', 'Sports'];
const STATUSES = ['ACTIVE', 'ENDED', 'CANCELLED'];
const PAYMENT_STATUSES = ['ACTIVE', 'PAID'];

const PRODUCT_NAMES = [
  'Vintage leather jacket',
  'Smart TV 55 inch',
  'Gaming laptop',
  'Antique watch',
  'Oil painting',
  'Ceramic vase',
  'Vintage camera',
  'Designer handbag',
  'Signed book',
  'Limited edition poster',
  'Bronze sculpture',
  'Vintage record player',
  'Art deco lamp',
  'Rare comic book',
  'Designer shoes',
  'Vintage guitar',
  'Antique mirror',
  'Gold necklace',
  'Original artwork',
  'Retro typewriter',
];

function generateAuctions(count) {
  const auctions = [];
  const now = new Date();
  const userId = '507f1f77bcf86cd799439011'; // Sample ObjectId-like string

  for (let i = 0; i < count; i++) {
    const startingPrice = Math.floor(Math.random() * 5000) + 10;
    const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
    const paymentStatus = PAYMENT_STATUSES[Math.floor(Math.random() * PAYMENT_STATUSES.length)];
    
    // Mix of past, current, and future end times
    const daysOffset = Math.floor(Math.random() * 10) - 5; // -5 to +5 days
    const endTime = new Date(now.getTime() + daysOffset * 24 * 60 * 60 * 1000 + Math.random() * 12 * 60 * 60 * 1000);
    
    // For ENDED auctions, ensure endTime is in the past
    const finalEndTime = status === 'ENDED' ? new Date(now.getTime() - Math.random() * 7 * 24 * 60 * 60 * 1000) : endTime;
    
    const startTime = new Date(finalEndTime.getTime() - (2 + Math.random() * 3) * 24 * 60 * 60 * 1000);
    
    const currentPrice = status === 'ENDED' ? startingPrice + Math.floor(Math.random() * 2000) : startingPrice + Math.floor(Math.random() * 500);
    const hasWinner = status === 'ENDED' && Math.random() > 0.3;
    
    const auction = {
      title: PRODUCT_NAMES[Math.floor(Math.random() * PRODUCT_NAMES.length)] + ` #${i}`,
      description: `High quality ${PRODUCT_NAMES[Math.floor(Math.random() * PRODUCT_NAMES.length)]}. In excellent condition. Perfect for collectors.`,
      images: [
        `https://example.com/image-${i}-1.jpg`,
        `https://example.com/image-${i}-2.jpg`,
      ],
      startingPrice,
      currentPrice,
      status,
      startTime,
      endTime: finalEndTime,
      category: CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)],
      createdBy: userId,
      highestBidder: status === 'ACTIVE' && Math.random() > 0.5 ? userId : undefined,
      winner: hasWinner ? userId : undefined,
      notified: hasWinner ? Math.random() > 0.5 : false,
      paymentStatus,
      paymentDueAt: hasWinner ? new Date(finalEndTime.getTime() + 3 * 24 * 60 * 60 * 1000) : undefined,
      winnerHistory: hasWinner ? [
        {
          userId,
          amount: currentPrice,
          reason: 'Auction won',
          changedAt: new Date(finalEndTime.getTime() + 1000),
        },
      ] : [],
    };
    
    auctions.push(auction);
  }

  return auctions;
}

async function seed() {
  try {
    console.log(`Connecting to MongoDB at ${mongoUri}...`);
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Check existing data
    const existingCount = await Auction.countDocuments();
    console.log(`📊 Current document count: ${existingCount}`);

    if (existingCount > 0) {
      console.log('⚠️  Collection already has data. Clearing it first...');
      await Auction.deleteMany({});
      console.log('🗑️  Collection cleared');
    }

    // Generate and insert data in batches
    console.log(`🌱 Generating ${batchSize} auction documents...`);
    const auctions = generateAuctions(batchSize);

    console.log(`📝 Inserting documents in batches...`);
    const chunkSize = 100;
    for (let i = 0; i < auctions.length; i += chunkSize) {
      const chunk = auctions.slice(i, i + chunkSize);
      await Auction.insertMany(chunk);
      console.log(`   ✓ Inserted ${Math.min(i + chunkSize, auctions.length)}/${batchSize}`);
    }

    // Verify results
    const finalCount = await Auction.countDocuments();
    console.log(`\n✅ Seeding complete!`);
    console.log(`📊 Final document count: ${finalCount}`);

    // Show distribution stats
    const statusCounts = await Auction.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    console.log(`📈 Status distribution:`);
    statusCounts.forEach(({ _id, count }) => {
      console.log(`   ${_id}: ${count}`);
    });

    const categoryCounts = await Auction.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);
    console.log(`🏷️  Top categories:`);
    categoryCounts.forEach(({ _id, count }) => {
      console.log(`   ${_id}: ${count}`);
    });

  } catch (error) {
    console.error('❌ Error during seeding:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

seed();
