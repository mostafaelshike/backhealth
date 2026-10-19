require('dotenv').config({ path: __dirname + '/../../.env' });
const connectDB = require('../config/db');
const User = require('../models/User');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Setting = require('../models/Setting');
const { users, categories, brands, sampleProducts } = require('./seedData');

const importData = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await connectDB();

    console.log('Clearing old data...');
    await User.deleteMany();
    await Category.deleteMany();
    await Brand.deleteMany();
    await Product.deleteMany();
    await Order.deleteMany();
    await Setting.deleteMany();

    console.log('Importing users...');
    const createdUsers = [];
    for (const u of users) {
      const created = await User.create(u);
      createdUsers.push(created);
    }
    const adminUser = createdUsers[0];
    const customerUser = createdUsers[1];

    console.log('Importing categories...');
    const categoryMap = {};
    for (const cat of categories) {
      const createdCat = await Category.create(cat);
      categoryMap[cat.code] = createdCat;
    }

    console.log('Importing brands...');
    const brandMap = {};
    for (const br of brands) {
      const createdBr = await Brand.create(br);
      brandMap[br.code] = createdBr;
    }

    console.log('Importing products...');
    const createdProducts = [];
    for (const prod of sampleProducts) {
      const cat = categoryMap[prod.categoryCode];
      const br = brandMap[prod.brandCode];

      const productToCreate = {
        ...prod,
        category: cat ? cat._id : Object.values(categoryMap)[0]._id,
        categoryName: cat ? cat.name : '',
        brand: br ? br._id : Object.values(brandMap)[0]._id,
        brandName: br ? br.name : '',
        images: [{ url: prod.image, publicId: 'seed_' + prod.sku }]
      };

      const createdProd = await Product.create(productToCreate);
      createdProducts.push(createdProd);

      // update counts
      if (cat) await Category.findByIdAndUpdate(cat._id, { $inc: { productCount: 1 } });
      if (br) await Brand.findByIdAndUpdate(br._id, { $inc: { productCount: 1 } });
    }

    console.log('Creating sample orders...');
    if (createdProducts.length >= 2) {
      const order1 = await Order.create({
        orderNumber: 'MED-2609-1082',
        user: customerUser._id,
        customerInfo: {
          name: customerUser.name,
          email: customerUser.email,
          phone: customerUser.phone,
          hospitalOrClinic: customerUser.organization,
          city: 'الرياض',
          address: 'حي السليمانية - شارع الأمير ممدوح',
          postalCode: '11564'
        },
        items: [
          {
            product: createdProducts[0]._id,
            name: createdProducts[0].name,
            image: createdProducts[0].image,
            sku: createdProducts[0].sku,
            price: createdProducts[0].price,
            quantity: 2,
            total: createdProducts[0].price * 2
          },
          {
            product: createdProducts[1]._id,
            name: createdProducts[1].name,
            image: createdProducts[1].image,
            sku: createdProducts[1].sku,
            price: createdProducts[1].price,
            quantity: 1,
            total: createdProducts[1].price
          }
        ],
        subtotal: createdProducts[0].price * 2 + createdProducts[1].price,
        shippingFee: 0,
        tax: 70,
        totalAmount: createdProducts[0].price * 2 + createdProducts[1].price + 70,
        paymentMethod: 'credit_card',
        paymentStatus: 'paid',
        orderStatus: 'processing',
        trackingNumber: 'TRK-SA-982312'
      });

      const order2 = await Order.create({
        orderNumber: 'MED-2609-1095',
        user: customerUser._id,
        customerInfo: {
          name: 'مجمع النخيل الطبي - د. إبراهيم الخالدي',
          email: 'dribrahim@alkhalidi.med.sa',
          phone: '+966 54 888 7777',
          hospitalOrClinic: 'مجمع النخيل الطبي',
          city: 'الدمام',
          address: 'طريق الملك فهد، حي الشاطئ',
          postalCode: '32414'
        },
        items: [
          {
            product: createdProducts[2]._id,
            name: createdProducts[2].name,
            image: createdProducts[2].image,
            sku: createdProducts[2].sku,
            price: createdProducts[2].price,
            quantity: 1,
            total: createdProducts[2].price
          }
        ],
        subtotal: createdProducts[2].price,
        shippingFee: 0,
        tax: 102,
        totalAmount: createdProducts[2].price + 102,
        paymentMethod: 'bank_transfer',
        paymentStatus: 'paid',
        orderStatus: 'delivered',
        deliveredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      });
    }

    console.log('Creating initial store settings...');
    await Setting.create({
      storeName: 'سوق طبي - Medical Market',
      email: 'contact@medicalmarket.com',
      phone: '+966 50 123 4567',
      address: 'طريق الملك فهد، الرياض، المملكة العربية السعودية',
      taxRate: 15,
      shippingFee: 35,
      freeShippingThreshold: 500
    });

    console.log('====================================================');
    console.log('✅ DATA IMPORTED SUCCESSFULLY!');
    console.log('Admin Account: admin@medicalmarket.com | Password: admin123456');
    console.log('User Account:  user@medicalmarket.com  | Password: user123456');
    console.log('====================================================');
    process.exit(0);
  } catch (error) {
    console.error(`❌ Error importing data: ${error.message}`);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    await connectDB();
    await User.deleteMany();
    await Category.deleteMany();
    await Brand.deleteMany();
    await Product.deleteMany();
    await Order.deleteMany();
    await Setting.deleteMany();
    console.log('🗑️ All data successfully destroyed!');
    process.exit(0);
  } catch (error) {
    console.error(`❌ Error destroying data: ${error.message}`);
    process.exit(1);
  }
};

if (process.argv[2] === '-d') {
  destroyData();
} else {
  importData();
}
