import * as dotenv from 'dotenv';

dotenv.config();

export const ENV_VARS = {
    OPEN_AI_KEY: process.env.OPEN_AI_KEY || '',
    TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '',
    USER_IDS: (process.env.USER_IDS || '').split(',').map(id => +id),
}
