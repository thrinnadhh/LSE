const express = require("express");
const { z } = require("zod");
const chatService = require("./chat-service");
const { requireAuth } = require("../../user-service/src/routes");
const { ApiError, asyncHandler } = require("../../../apps/api-gateway/src/lib/errors");

function createChatRouter({ db, onMessagePersisted, onOrderCreated }) {
  const router = express.Router();

  router.post(
    "/conversations",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const conversation = await chatService.createOrGetConversation({
          body: req.body,
          auth: req.auth,
          db,
        });
        res.status(200).json(conversation);
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, err.issues[0].message);
        }
        throw err;
      }
    })
  );

  router.get(
    "/conversations/:conversationId/messages",
    requireAuth,
    asyncHandler(async (req, res) => {
      const items = await chatService.getConversationMessages({
        conversationId: req.params.conversationId,
        auth: req.auth,
        db,
      });
      res.status(200).json({ items });
    })
  );

  router.post(
    "/messages",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const { message, participants } = await chatService.sendMessage({
          body: req.body,
          auth: req.auth,
          db,
        });

        if (onMessagePersisted) {
          await onMessagePersisted({
            ...message,
            customerId: participants.customerId,
            shopOwnerId: participants.shopOwnerId,
          });
        }

        res.status(201).json(message);
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, err.issues[0].message);
        }
        throw err;
      }
    })
  );

  router.post(
    "/quotes",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const quote = await chatService.createQuote({
          body: req.body,
          auth: req.auth,
          db,
        });

        res.status(201).json(quote);
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, err.issues[0].message);
        }
        throw err;
      }
    })
  );

  router.get(
    "/conversations/:conversationId/quotes",
    requireAuth,
    asyncHandler(async (req, res) => {
      const items = await chatService.listConversationQuotes({
        conversationId: req.params.conversationId,
        auth: req.auth,
        db,
      });

      res.status(200).json({ items });
    })
  );

  router.post(
    "/quotes/:quoteId/accept",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const quote = await chatService.acceptQuote({
          quoteId: req.params.quoteId,
          auth: req.auth,
          db,
        });

        if (onOrderCreated) {
          try {
            await onOrderCreated({ orderId: quote.orderId });
          } catch (publishErr) {
            console.error("failed to publish ORDER_CREATED", publishErr.message);
          }
        }

        res.status(200).json(quote);
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, err.issues[0].message);
        }
        throw err;
      }
    })
  );

  return router;
}

module.exports = { createChatRouter };
