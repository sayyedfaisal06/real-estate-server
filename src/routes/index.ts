// src/routes/index.ts
import { Router } from 'express';
import leadsRouter from '../modules/leads/leads.routes';
import communicationsRouter from '../modules/communications/communications.routes';
import inventoryRouter from '../modules/inventory/inventory.routes';
import visitsRouter from '../modules/visits/visits.routes';
import analyticsRouter from '../modules/analytics/analytics.routes';
import followUpsRouter from '../modules/notifications/followups.routes';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
});

// Module routes
router.use('/leads', leadsRouter);
router.use('/communications', communicationsRouter);
router.use('/inventory', inventoryRouter);
router.use('/visits', visitsRouter);
router.use('/analytics', analyticsRouter);
router.use('/follow-ups', followUpsRouter);

export default router;
