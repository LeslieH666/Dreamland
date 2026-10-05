import express from 'express';

export const LESLIE_MOBILE_PROTOCOL_VERSION = '1';
export const LESLIE_MOBILE_API_ROOT = '/api/leslie/mobile/v1';

export const router = express.Router();

router.get('/health', (_request, response) => {
    response
        .set('Cache-Control', 'no-store')
        .set('X-DreamLand-Mobile-Version', LESLIE_MOBILE_PROTOCOL_VERSION)
        .json({
            status: 'ok',
            service: 'dreamland-mobile',
            protocol: {
                name: 'dreamland-mobile',
                version: LESLIE_MOBILE_PROTOCOL_VERSION,
            },
        });
});
