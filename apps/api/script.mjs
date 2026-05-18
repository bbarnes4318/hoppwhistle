
import { getRedisClient } from "./services/redis.js";
async function main() {
  const redis = await getRedisClient();
  const keys = await redis.keys("agent:*");
  for (const key of keys) {
    const val = await redis.get(key);
    console.log(key, val);
  }
}
main().catch(console.error).finally(() => process.exit(0));

