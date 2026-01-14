require('dotenv').config();

const KrakenClient = require('./dist/KrakenClient').default;

const apiKey = process.env.KRAKEN_API_KEY;
const apiSecret = process.env.KRAKEN_API_SECRET;

async function test() {
  console.log('=== Testing Kraken placeOrder ===\n');

  const client = new KrakenClient(apiKey, apiSecret);

  try {
    // Test with a very small order (0.00001 BTC = ~$0.40)
    console.log('Placing test BUY order for 0.00001 BTC/USD...');
    const orderId = await client.placeOrder('BTC/USD', 'buy', 0.00001);

    if (orderId) {
      console.log('✅ Order placed successfully!');
      console.log('Order ID:', orderId);
      process.exit(0);
    } else {
      console.log('❌ placeOrder returned null');
      process.exit(1);
    }
  } catch (error) {
    console.log('❌ Error:', error instanceof Error ? error.message : String(error));
    console.log(error instanceof Error ? error.stack : '');
    process.exit(1);
  }
}

test();
