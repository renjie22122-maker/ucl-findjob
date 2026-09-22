import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { parse, parseId } from '../middleware/validate.js';
import {
  createReminder,
  deleteReminder,
  listReminders,
  setReminderDone,
  updateReminder,
} from '../services/reminders.service.js';

const router = Router();

const reminderSchema = z.object({
  applicationId: z.number().int().positive('请选择申请'),
  type: z.enum(['written_test', 'interview', 'deadline', 'other']),
  title: z.string().trim().min(1, '标题不能为空').max(200),
  scheduledAt: z.string().trim().min(1, '提醒时间不能为空').max(30),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = req.query;
    const items = listReminders({
      from: typeof q.from === 'string' ? q.from : undefined,
      to: typeof q.to === 'string' ? q.to : undefined,
      done: q.done === 'true' ? true : q.done === 'false' ? false : undefined,
    });
    res.json({ items });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(reminderSchema, req.body);
    res.status(201).json(createReminder(input));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parse(reminderSchema.partial(), req.body);
    res.json(updateReminder(parseId(req.params.id), input));
  }),
);

router.patch(
  '/:id/done',
  asyncHandler(async (req, res) => {
    const input = parse(z.object({ done: z.boolean() }), req.body);
    res.json(setReminderDone(parseId(req.params.id), input.done));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    deleteReminder(parseId(req.params.id));
    res.status(204).end();
  }),
);

export default router;
