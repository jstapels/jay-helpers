const MODULE_ID = 'jay-helpers';

// Setting keys
const SETTINGS = {
  TRACK_ACTION: {
    id: "trackAction",
    type: Boolean,
    default: false,
    scope: "client",
  },
  TRACK_BONUS: {
    id: "trackBonus",
    type: Boolean,
    default: true,
    scope: "client",
  },
  TRACK_REACTION: {
    id: "trackReaction",
    type: Boolean,
    default: true,
    scope: "client",
  },
  TRACK_OPPORTUNITY: {
    id: "trackOpportunity",
    type: Boolean,
    default: true,
    scope: "client",
  },
  APPLY_SELF_EFFECTS: {
    id: "applySelfEffects",
    type: Boolean,
    default: true,
    scope: "client",
  },
  WARN_NO_TARGET: {
    id: "warnNoTarget",
    type: Boolean,
    default: true,
    scope: "client",
  },
  PREVENT_IDENTIFICATION: {
    id: "preventIdentification",
    type: Boolean,
    default: true,
    scope: "world",
  },
  RED_BLOODIED: {
    id: "redBloodied",
    type: Boolean,
    default: true,
    scope: "world",
    requiresReload: true,
  },
  OVERLAY_BLOODIED: {
    id: "overlayBloodied",
    type: Boolean,
    default: true,
    scope: "world",
    requiresReload: true,
  },
  SYNC_DEFEATED: {
    id: "syncDefeated",
    type: Boolean,
    default: true,
    scope: "world",
  },
  SYNC_UNCONSCIOUS: {
    id: "syncUnconscious",
    type: Boolean,
    default: true,
    scope: "world",
  },
  SHOW_CARD_PLAY_DETAILS: {
    id: "showCardPlayDetails",
    type: Boolean,
    default: true,
    scope: "world",
  },
};

const CARD_CHAT_DETAIL_FLAG = "cardDetails";
const CARD_CHAT_DETAIL_TTL = 10000;
const CARD_CHAT_DETAIL_FALLBACK_KEY = `${MODULE_ID}.cardDetails.fallback`;
const pendingCardChatDetails = new Map();

const CARD_HAND_SHEET_TEMPLATE = `modules/${MODULE_ID}/templates/horizontal-card-hand.hbs`;

/**
 * Log to the console.
 * 
 * @param  {...any} args log parameters
 */
const log = (...args) => {
  // eslint-disable-next-line no-console
  console.log(`${MODULE_ID} |`, ...args);
};

const actionConfig = {
  action: {
    name: 'Action - ',
    icon: `modules/${MODULE_ID}/images/action.svg`,
    description: 'Action taken',
    duration: { rounds: 1 },
  },
  bonus: {
    name: 'Bonus Action: ',
    icon: `modules/${MODULE_ID}/images/bonus.svg`,
    description: 'Action taken',
    duration: { rounds: 1 },
  },
  reaction: {
    name: 'Reaction: ',
    icon: `modules/${MODULE_ID}/images/reaction.svg`,
    description: 'Action taken',
    duration: { rounds: 1 },
  },
};

const actionSetting = {
  action: SETTINGS.TRACK_ACTION.id,
  bonus: SETTINGS.TRACK_BONUS.id,
  reaction: SETTINGS.TRACK_REACTION.id,
};

const getActionEffect = (actor, actionType, { includeDisabled = false } = {}) => {
  return actor.effects.find((effect) => {
    const effectActionType = effect.getFlag(MODULE_ID, 'actionType');
    if (effectActionType !== actionType) return false;
    if (!includeDisabled && effect.disabled) return false;
    return true;
  });
};

const actorInCombat = (actor) => {
  return game.combat?.getCombatantByActor(actor);
};

const isActionEnabled = (actionType) => {
  const settingId = actionSetting[actionType];
  if (!settingId) return false;
  return game.settings.get(MODULE_ID, settingId);
};

const checkActionUsage = async (actor, item, actionType) => {
  const existingEffect = getActionEffect(actor, actionType);

  // Create if no existing effect.
  if (!existingEffect) {
    return true;
  }

  const warned = existingEffect.getFlag(MODULE_ID, 'warned');
  if (!warned) {
    const usedItemName = existingEffect.name.replace(actionConfig[actionType].name, '');
    ui.notifications.warn(`You already used your ${actionType} on ${usedItemName}, try again if you really want to use it.`);
    await existingEffect.setFlag(MODULE_ID, 'warned', true);
    return false;
  }

  return true;
};

const createActionUsage = async (actor, item, actionType) => {
  // Check if effect already exists
  const existingEffect = getActionEffect(actor, actionType);

  if (existingEffect) {
    // Update existing effect with new item name and reset warned flag
    log(`Action effect for ${actionType} already exists, updating with new item`);
    const newName = actionConfig[actionType].name + item.name;
    await existingEffect.update({ name: newName });
    return;
  }

  // Create new action effect
  const effectData = {
    ...actionConfig[actionType],
    origin: actor.uuid,
    flags: {
      [MODULE_ID]: {
        actionType,
        warned: false,
      },
    },
  };
  effectData.name += item.name;
  await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
};

let preUseActivity = async (activity) => {
  log('Checking activity', activity);

  const item = activity?.parent?.parent;
  const actor = item?.actor;

  // Make sure actor is IN the combat.
  if (!actorInCombat(actor)) return true;

  // Make sure there's a config for it.
  const actionType = activity.activation?.type;
  if (!actionConfig[actionType]) {
    return true;
  }

  // Make sure the tracking is enabled.
  const settingId = actionSetting[actionType];
  if (!settingId || !game.settings.get(MODULE_ID, settingId)) {
    return true;
  }

  return checkActionUsage(actor, item, actionType);
};

const applyActorSelfEffects = async (actor, effects, origin) => {
  // Apply associated effects.
  for (const effect of effects) {
    log("Activate effect", effect);
    // Enable an existing effect on the target if it originated from this effect
    const existingEffect = actor.effects.find((e) => e.origin === origin.uuid);
    if (existingEffect) {
      await existingEffect.update({
        ...effect.constructor.getInitialDuration(),
        disabled: false,
      });
    } else {
      // Otherwise, create a new effect on the target
      const effectData = {
        ...effect.toObject(),
        disabled: false,
        transfer: false,
        origin: origin.uuid,
      };
      await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
    }
  }
};

const postUseActivity = async (activity) => {
  log('Activity used', activity);

  const item = activity?.parent?.parent;
  const actor = item?.actor;

  // Make sure actor is IN the combat.
  if (!actorInCombat(actor)) return;

  // Check for any self effects and apply them.
  const selfTarget = activity.target?.affects?.type === "self";
  const selfRange = activity.range?.units === "self";
  const applySelfEffects = game.settings.get(MODULE_ID, SETTINGS.APPLY_SELF_EFFECTS.id);
  if ((selfTarget || selfRange) && activity.effects && applySelfEffects) {
    log("Found self effects to apply");
    const effects = activity.effects.map((e) => e.effect);
    await applyActorSelfEffects(actor, effects, item);
  }

  // Apply action effect, if there's a config for it and it's enabled.
  const actionType = activity.activation?.type;
  if (isActionEnabled(actionType)) {
    log(`A tracked action ${actionType} was used`);
    await createActionUsage(actor, item, actionType);
  }

  const warnNoTarget = game.settings.get(MODULE_ID, SETTINGS.WARN_NO_TARGET.id);
  if (warnNoTarget) {
    const target = game.user.targets?.size;
    const attack = activity.type === 'attack';
    if (attack && !target) {
      ui.notifications.warn(`Don't forget to target an enemy.`);
    }
  }
};

let preRollAttack = async (config) => {
  const trackOpportunity = game.settings.get(MODULE_ID, SETTINGS.TRACK_OPPORTUNITY.id);
  if (!trackOpportunity) return true;

  const activity = config.subject;
  const item = activity?.parent?.parent;
  const actor = item?.actor;

  const combatant = game.combat?.getCombatantByActor(item.actor);
  if (!combatant) return true;

  // Legendary actions don't consume reactions.
  if (activity.activation?.type === 'legendary') return true;

  // If attacking and it's not owner's turn, assume an opportunity attack, check reaction.
  if (game.combat.combatant.id !== combatant.id) {
    return checkActionUsage(actor, item, 'reaction');
  }

  return true;
};

let rollAttack = async (rolls, data) => {
  const trackOpportunity = game.settings.get(MODULE_ID, SETTINGS.TRACK_OPPORTUNITY.id);
  if (!trackOpportunity) return;

  const activity = data.subject;
  const item = activity?.parent?.parent;
  const actor = item?.actor;

  const combatant = game.combat?.getCombatantByActor(item.actor);
  if (!combatant) return;

  // Legendary actions don't consume reactions.
  if (activity.activation?.type === 'legendary') return;

  // If attacking and it's not your turn, assume an opportunity attack, use reaction.
  const reactionEnable = game.settings.get(MODULE_ID, SETTINGS.TRACK_REACTION.id);
  if (reactionEnable && game.combat.combatant.id !== combatant.id) {
    ui.notifications.info("You're attacking when it's not your turn, assuming an Opportunity Attack.");
    await createActionUsage(actor, item, 'reaction');
  }
};

// Remove Identify button at top of Item Sheet
const removeIdentifyButton = (sheet, [html]) => {
  if (game.user.isGM) return;

  const preventIdentification = game.settings.get(MODULE_ID, SETTINGS.PREVENT_IDENTIFICATION.id);
  if (!preventIdentification) return;

  const unidentified = sheet.item.system.identified === false;
  if (!unidentified) return;
  html.querySelectorAll(".pseudo-header-button.state-toggle.toggle-identified")
    .forEach((n) => n.remove());
};


// Remove Identify button from Item Context menu on Actor Sheet
const removeIdentifyMenu = (item, buttons) => {
  if (game.user.isGM) return;

  const preventIdentification = game.settings.get(MODULE_ID, SETTINGS.PREVENT_IDENTIFICATION.id);
  if (!preventIdentification) return;

  const unidentified = item.system.identified === false;
  if (!unidentified) return;
  const identifyIndex = buttons.findIndex((opt) => opt.name === 'DND5E.Identify');
  if (identifyIndex >= 0) {
    buttons.splice(identifyIndex, 1);
  }
};

const preCreateActiveEffect = (effect) => {
  const redBloodied = game.settings.get(MODULE_ID, SETTINGS.RED_BLOODIED.id);
  const overlayBloodied = game.settings.get(MODULE_ID, SETTINGS.OVERLAY_BLOODIED.id);
  const bloodiedEnabled = redBloodied || overlayBloodied;
  const bloodiedEffect = (effect._id === dnd5e.documents.ActiveEffect5e.ID.BLOODIED);
  if (bloodiedEffect && bloodiedEnabled) {
    const updates = {};
    if (redBloodied) updates.tint = "#FF0000";
    if (overlayBloodied) {
      updates['flags.core.overlay'] = true;
    }
    effect.updateSource(updates);
  }
};

const applyDamage = async (actor, damage, options) => {
  log('applyDamage', actor, damage, options);

  // Only track combatants
  const combatant = game.combat?.getCombatantByActor(actor);
  if (!combatant) return;

  const importantChar = actor.type === 'character' || (actor.type === 'npc' && actor.system.traits.important);
  const applyUnconscious = game.settings.get(MODULE_ID, SETTINGS.SYNC_UNCONSCIOUS.id);
  if (importantChar && applyUnconscious) {
    const unconsciousId = CONFIG.specialStatusEffects.UNCONSCIOUS;
    const isDead = actor.system.attributes?.hp?.value === 0;
    const isUnconscious = actor.statuses.has(unconsciousId);
    if (isDead !== isUnconscious) {
      await actor.toggleStatusEffect(unconsciousId);
    }
  }

  if (!game.user.isGM) return;

  const unimportantNpc = actor.type === 'npc' && !actor.system.traits.important;
  const overlayBloodied = game.settings.get(MODULE_ID, SETTINGS.OVERLAY_BLOODIED.id);
  const applyDefeated = game.settings.get(MODULE_ID, SETTINGS.SYNC_DEFEATED.id);
  if (unimportantNpc && applyDefeated) {
    const isDead = actor.system.attributes?.hp?.value === 0;
    const isDefeated = combatant.defeated;
    log('Checking defeated', actor.name, isDead, isDefeated);
    if (isDefeated !== isDead) {
      const defeatedId = CONFIG.specialStatusEffects.DEFEATED;
      await combatant.update({ defeated: isDead });
      await actor.toggleStatusEffect(defeatedId, { overlay: true, active: isDead });
      const bloodied = actor.effects.get(dnd5e.documents.ActiveEffect5e.ID.BLOODIED);
      if (bloodied && overlayBloodied) {
        await bloodied.setFlag('core', 'overlay', !isDead);
      }
    }
  }
};

const applyTokenStatusEffect = async (token, status, state) => {
  log('applyTokenStatusEffect', token, status, state);
  if (!game.user.isGM) return;

  const actor = token.actor;
  if (!actor) return;

  // Only track combatants
  const combatant = game.combat?.getCombatantByActor(actor);
  if (!combatant) return;

  // Only track NPCs
  if (actor.type !== 'npc') return;

  const applyDefeated = game.settings.get(MODULE_ID, SETTINGS.SYNC_DEFEATED.id);
  const overlayBloodied = game.settings.get(MODULE_ID, SETTINGS.OVERLAY_BLOODIED.id);
  const isDefeatedStatus = status === CONFIG.specialStatusEffects.DEFEATED;
  if (applyDefeated && isDefeatedStatus) {
    const isDead = actor.system.attributes?.hp?.value === 0;
    log('Confirming defeated', actor.name, isDead);
    if (state !== isDead) {
      await actor.update({ 'system.attributes.hp': { value: state ? 0 : 1, temp: 0 } });
      const bloodied = actor.effects.get(dnd5e.documents.ActiveEffect5e.ID.BLOODIED);
      if (bloodied && overlayBloodied) {
        await bloodied.setFlag('core', 'overlay', !isDead);
      }
    }
  }
};

const getMessageFlag = (message, scope, key) => {
  try {
    return message.getFlag(scope, key);
  } catch {
    return message.flags?.[scope]?.[key];
  }
};

const getModuleFlag = (document, key) => {
  return getMessageFlag(document, MODULE_ID, key);
};

const getCardFromUuid = (uuid) => {
  if (!uuid) return null;
  try {
    const document = fromUuidSync(uuid);
    if (document?.documentName === "Card") return document;
  } catch {
    return null;
  }
  return null;
};

const findCardById = (cardId) => {
  if (!cardId) return null;
  for (const cards of game.cards ?? []) {
    const card = cards.cards?.get(cardId);
    if (card) return card;
  }
  return null;
};

const getCardsUuidPattern = /@UUID\[(Cards\.[^\]]+)\]/g;

const getCardsUuidsFromContent = (content) => {
  return Array.from(content?.matchAll(getCardsUuidPattern) ?? [], (match) => match[1]);
};

const getCardsUuidsFromHtml = (html) => {
  const uuidNodes = html.querySelectorAll("[data-uuid^='Cards.'], [data-document-uuid^='Cards.']");
  return Array.from(uuidNodes, (node) => node.dataset.uuid ?? node.dataset.documentUuid).filter(Boolean);
};

const getChatCardsUuids = (message, html) => {
  return [
    ...getCardsUuidsFromContent(message.content),
    ...getCardsUuidsFromHtml(html),
  ];
};

const getChatCardFromMessage = (message) => {
  const cardUuid = getMessageFlag(message, "core", "cardUuid")
    ?? getMessageFlag(message, "cards", "cardUuid")
    ?? getMessageFlag(message, "core", "sourceUuid")
    ?? getMessageFlag(message, "core", "sourceId");

  const cardFromUuid = getCardFromUuid(cardUuid);
  if (cardFromUuid) return cardFromUuid;

  const cardId = getMessageFlag(message, "cards", "cardId");
  return findCardById(cardId);
};

const getCardFaceUpFlag = (message) => {
  return getMessageFlag(message, "cards", "faceUp")
    ?? getMessageFlag(message, "core", "faceUp")
    ?? getMessageFlag(message, "cards", "isFaceUp")
    ?? message.flags?.cards?.card?.faceUp
    ?? message.flags?.cards?.cardData?.faceUp;
};

const getCardFaceDownFlag = (message) => {
  return getMessageFlag(message, "cards", "facedown")
    ?? getMessageFlag(message, "core", "facedown")
    ?? getMessageFlag(message, "cards", "isFaceDown")
    ?? message.flags?.cards?.card?.facedown
    ?? message.flags?.cards?.cardData?.facedown;
};

const isCardMessageFaceUp = (message, card) => {
  if (typeof card?.showFace === "boolean") return card.showFace;

  const faceUpFlag = getCardFaceUpFlag(message);
  if (typeof faceUpFlag === "boolean") return faceUpFlag;

  const facedownFlag = getCardFaceDownFlag(message);
  if (typeof facedownFlag === "boolean") return !facedownFlag;

  return false;
};

const getCardImage = (card) => {
  return card?.img ?? card?.currentFace?.img ?? card?.faces?.[card.face]?.img ?? null;
};

const getCardDescription = (card) => {
  return card?.currentFace?.description ?? card?.description ?? "";
};

const getCardFace = (card) => {
  const faceIndex = card?.face;
  return card?.currentFace ?? card?.faces?.[faceIndex] ?? null;
};

const isCardSnapshotFaceUp = (card) => {
  if (typeof card?.showFace === "boolean") return card.showFace;
  return card?.face !== null && card?.face !== undefined;
};

const getCardSnapshotImage = (card) => {
  const face = getCardFace(card);
  return card?.img ?? face?.img ?? null;
};

const getCardSnapshotDescription = (card) => {
  const face = getCardFace(card);
  return face?.description ?? card?.description ?? "";
};

const getCardSnapshot = (card) => {
  const image = getCardSnapshotImage(card);
  if (!card || !image || !isCardSnapshotFaceUp(card)) return null;

  return {
    name: card.name,
    description: getCardSnapshotDescription(card),
    image,
    suit: card.suit ?? card.system?.suit,
    value: card.value ?? card.system?.value,
    uuid: card.uuid ?? null,
  };
};

const getFaceCount = (card) => {
  return card?.faces?.length ?? 0;
};

const getCardFaceIndex = (card) => {
  return Number.isInteger(card?.face) ? card.face : null;
};

const getNextCardFace = (card) => {
  const currentFace = getCardFaceIndex(card);
  if (currentFace === null) return 0;
  if (card.hasNextFace) return currentFace + 1;
  return null;
};

const getCardThumbnailData = (card) => {
  const faceIndex = getCardFaceIndex(card);
  const faceCount = getFaceCount(card);
  const label = faceIndex === null
    ? game.i18n.localize(`${MODULE_ID}.cards.faceDown`)
    : game.i18n.format(`${MODULE_ID}.cards.faceNumber`, {
      number: faceIndex + 1,
      total: faceCount,
    });

  return {
    faceLabel: label,
    faceUp: Boolean(card.showFace),
    id: card.id,
    img: card.img,
    name: card.name,
  };
};

class HorizontalCardHandConfig extends foundry.applications.sheets.CardHandConfig {
  static DEFAULT_OPTIONS = {
    window: { resizable: true },
    position: { width: 800, height: 500 },
    actions: {
      flipCard: HorizontalCardHandConfig.flipCard,
      playCard: HorizontalCardHandConfig.playCard,
    },
  };

  static PARTS = foundry.utils.mergeObject(
    super.PARTS,
    {
      cards: {
        root: true,
        scrollable: [".cards"],
        template: CARD_HAND_SHEET_TEMPLATE,
      },
    },
    { inplace: false },
  );

  async _preparePartContext(partId, context, options) {
    const preparedContext = await super._preparePartContext(partId, context, options);
    if (partId !== "cards") return preparedContext;
    const cards = preparedContext.cards ?? this._prepareCards();
    return {
      ...preparedContext,
      handCards: cards.map((card) => getCardThumbnailData(card.document ?? card)),
    };
  }

  _getCardFromTarget(target) {
    const cardId = target.closest("[data-card-id]")?.dataset.cardId;
    return cardId ? this.document.cards.get(cardId) : null;
  }

  static async flipCard(event, target) {
    event.preventDefault();
    const card = this._getCardFromTarget(target);
    if (!card) return;
    await card.flip(getNextCardFace(card));
  }

  static async playCard(event, target) {
    event.preventDefault();
    const card = this._getCardFromTarget(target);
    if (!card) return;
    await this.document.playDialog(card);
  }
}

const registerHorizontalCardHandSheet = () => {
  DocumentSheetConfig.registerSheet(CONFIG.Cards.documentClass, MODULE_ID, HorizontalCardHandConfig, {
    label: `${MODULE_ID}.cards.sheetName`,
    types: ["hand"],
    makeDefault: false,
  });
};

const normalizeCardCreateOperation = (operation) => {
  if (!operation) return [];
  if (Array.isArray(operation)) return operation.flatMap(normalizeCardCreateOperation);
  if (Array.isArray(operation.data)) return operation.data.flatMap(normalizeCardCreateOperation);
  if (operation.data) return normalizeCardCreateOperation(operation.data);
  return [operation];
};

const normalizeCreatedCards = (toCreate, destinationIndex) => {
  const created = toCreate[destinationIndex];
  if (Array.isArray(created)) return created.flatMap(normalizeCardCreateOperation);
  if (Array.isArray(toCreate) && toCreate.every((entry) => Array.isArray(entry))) return [];
  return normalizeCardCreateOperation(toCreate);
};

const getCardsDocument = (document) => {
  return document?.documentName === "Cards" ? document : null;
};

const getCardIdentifier = (card) => {
  return card?.id ?? card?._id;
};

const cardBelongsToCardsDocument = (cardsDocument, card) => {
  const cardId = getCardIdentifier(card);
  return Boolean(cardId && cardsDocument.cards?.get(cardId));
};

const getCardParentCardsDocument = (card) => {
  return getCardsDocument(card?.parent);
};

const getCardDetailsDestination = (cards, candidates) => {
  return cards.map(getCardParentCardsDocument).find(Boolean)
    ?? candidates.find((candidate) => cards.some((card) => cardBelongsToCardsDocument(candidate, card)));
};

const isDrawCardAction = (action) => {
  return typeof action === "string" && action.toLowerCase().includes("draw");
};

const isDrawCardMessageContent = (content) => {
  const text = document.createElement("div");
  text.innerHTML = content ?? "";
  return (/\bdraw(?:s|n|ing)?\b|\bdrew\b/i).test(text.textContent ?? "");
};

const getCardDetailsKey = (cardDetails) => {
  return cardDetails.map((detail) => detail.uuid ?? `${detail.name}:${detail.image}`).join("|");
};

const registerPendingCardChatDetails = (destination, cards, action, { fallback = false } = {}) => {
  const cardDetails = cards.map(getCardSnapshot).filter(Boolean);
  if (!cardDetails.length) return;

  const destinations = Array.isArray(destination) ? destination : [destination];
  const details = {
    action,
    cards: cardDetails,
    createdAt: Date.now(),
    key: getCardDetailsKey(cardDetails),
  };
  const destinationUuids = new Set();
  if (fallback) destinationUuids.add(CARD_CHAT_DETAIL_FALLBACK_KEY);

  for (const entry of destinations) {
    const cardsDocument = getCardsDocument(entry);
    if (!cardsDocument) continue;
    if (destinationUuids.has(cardsDocument.uuid)) continue;
    destinationUuids.add(cardsDocument.uuid);
  }

  for (const destinationUuid of destinationUuids) {
    const destinationQueue = pendingCardChatDetails.get(destinationUuid) ?? [];
    if (destinationQueue.some((queuedDetails) => queuedDetails.key === details.key)) continue;
    destinationQueue.push(details);
    pendingCardChatDetails.set(destinationUuid, destinationQueue);
  }
};

const captureDealtCardDetails = (origin, destinations, context) => {
  const enabled = game.settings.get(MODULE_ID, SETTINGS.SHOW_CARD_PLAY_DETAILS.id);
  if (!enabled) return;

  const toCreate = context.toCreate ?? [];
  destinations.forEach((destination, index) => {
    registerPendingCardChatDetails(destination, normalizeCreatedCards(toCreate, index), context.action, {
      fallback: isDrawCardAction(context.action),
    });
  });
};

const capturePassedCardDetails = (origin, destination, context) => {
  const enabled = game.settings.get(MODULE_ID, SETTINGS.SHOW_CARD_PLAY_DETAILS.id);
  if (!enabled) return;

  const cards = normalizeCardCreateOperation(context.toCreate ?? context.toUpdate ?? []);
  registerPendingCardChatDetails(destination, cards, context.action);
};

const captureDrawnCardDetails = (...args) => {
  const enabled = game.settings.get(MODULE_ID, SETTINGS.SHOW_CARD_PLAY_DETAILS.id);
  if (!enabled) return;

  const context = args.at(-1);
  const cards = normalizeCardCreateOperation(context?.toCreate ?? context?.toUpdate ?? []);
  const candidates = args.map(getCardsDocument).filter(Boolean);
  const destination = getCardDetailsDestination(cards, candidates);
  registerPendingCardChatDetails([destination, ...candidates], cards, context?.action, { fallback: true });
};

const captureCreatedCardDetails = (card, context) => {
  const enabled = game.settings.get(MODULE_ID, SETTINGS.SHOW_CARD_PLAY_DETAILS.id);
  if (!enabled) return;

  const parent = getCardsDocument(card.parent);
  if (!parent || parent.type === "deck") return;

  const action = context?.action;
  if (action && !isDrawCardAction(action)) return;
  registerPendingCardChatDetails(parent, [card], action ?? "draw", { fallback: true });
};

const removePendingCardChatDetails = (details) => {
  for (const [destinationUuid, queue] of pendingCardChatDetails) {
    const filteredQueue = queue.filter((queuedDetails) => queuedDetails !== details && queuedDetails.key !== details.key);
    if (filteredQueue.length) pendingCardChatDetails.set(destinationUuid, filteredQueue);
    else pendingCardChatDetails.delete(destinationUuid);
  }
};

const getPersistableCardDetails = (details) => {
  if (!details) return null;
  return {
    action: details.action,
    cards: details.cards,
    createdAt: details.createdAt,
  };
};

const consumePendingCardChatDetails = (destinationUuids) => {
  const now = Date.now();
  for (const destinationUuid of destinationUuids) {
    const queue = pendingCardChatDetails.get(destinationUuid);
    if (!queue?.length) continue;

    const freshQueue = queue.filter((details) => now - details.createdAt <= CARD_CHAT_DETAIL_TTL);
    if (freshQueue.length) pendingCardChatDetails.set(destinationUuid, freshQueue);
    else pendingCardChatDetails.delete(destinationUuid);
    const details = freshQueue[0];
    if (details) removePendingCardChatDetails(details);
    if (details) return details;
  }

  return null;
};

const addCardDetailsToChatMessage = (message) => {
  const enabled = game.settings.get(MODULE_ID, SETTINGS.SHOW_CARD_PLAY_DETAILS.id);
  if (!enabled) return;

  let details = consumePendingCardChatDetails(getCardsUuidsFromContent(message.content));
  if (!details && isDrawCardMessageContent(message.content)) {
    details = consumePendingCardChatDetails([CARD_CHAT_DETAIL_FALLBACK_KEY]);
  }
  if (!details) return;
  message.updateSource({ [`flags.${MODULE_ID}.${CARD_CHAT_DETAIL_FLAG}`]: getPersistableCardDetails(details) });
};

const persistCardDetailsToChatMessage = async (message, details) => {
  if (!details?.cards?.length || getModuleFlag(message, CARD_CHAT_DETAIL_FLAG)) return;

  try {
    await message.setFlag(MODULE_ID, CARD_CHAT_DETAIL_FLAG, getPersistableCardDetails(details));
  } catch (error) {
    log("Unable to persist card chat details", error);
  }
};

const getCardLabel = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return value.trim() || null;
  return String(value);
};

const enrichCardChatMessage = async (message, html) => {
  const enabled = game.settings.get(MODULE_ID, SETTINGS.SHOW_CARD_PLAY_DETAILS.id);
  if (!enabled) return;

  const contentNode = html.querySelector(".message-content");
  if (!contentNode) return;
  if (contentNode.querySelector(".jay-helpers-card-chat-details")) return;

  let cardDetails = getModuleFlag(message, CARD_CHAT_DETAIL_FLAG);
  if (!cardDetails) {
    cardDetails = consumePendingCardChatDetails(getChatCardsUuids(message, html));
  }

  let detailsToRender = cardDetails?.cards ?? [];
  if (!detailsToRender.length) {
    const card = getChatCardFromMessage(message);
    const cardImage = getCardImage(card);
    if (!card || !cardImage || !isCardMessageFaceUp(message, card)) return;

    detailsToRender = [{
      description: getCardDescription(card),
      image: cardImage,
      name: card.name,
      suit: card.suit ?? card.system?.suit,
      uuid: card.uuid,
      value: card.value ?? card.system?.value,
    }];
    cardDetails = { cards: detailsToRender };
  }

  const renderCardButton = (detail) => {
    const cardLink = document.createElement("button");
    cardLink.classList.add("jay-helpers-card-link");
    cardLink.type = "button";
    cardLink.title = game.i18n.localize("JOURNAL.ActionShow");
    cardLink.style.background = "none";
    cardLink.style.border = "0";
    cardLink.style.boxSizing = "border-box";
    cardLink.style.cursor = "pointer";
    cardLink.style.display = "flex";
    cardLink.style.flex = "0 0 48px";
    cardLink.style.height = "48px";
    cardLink.style.lineHeight = "0";
    cardLink.style.overflow = "hidden";
    cardLink.style.padding = "0";
    cardLink.style.width = "48px";

    const image = document.createElement("img");
    image.src = detail.image;
    image.alt = detail.name;
    image.style.border = "0";
    image.style.display = "block";
    image.style.height = "100%";
    image.style.maxHeight = "none";
    image.style.maxWidth = "none";
    image.style.objectFit = "cover";
    image.style.width = "100%";
    cardLink.append(image);

    cardLink.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const popout = new ImagePopout({
        src: detail.image,
        uuid: detail.uuid,
        window: { title: detail.name },
      });
      popout.render(true);
    });
    return cardLink;
  };

  const renderCardDetails = async (detail) => {
    const description = await foundry.applications.ux.TextEditor.enrichHTML(detail.description ?? "", { async: true });
    const suit = getCardLabel(detail.suit);
    const value = getCardLabel(detail.value);
    const meta = [
      suit ? `<span><strong>Suit:</strong> ${suit}</span>` : null,
      value ? `<span><strong>Value:</strong> ${value}</span>` : null,
    ].filter(Boolean).join(" <span aria-hidden=\"true\">•</span> ");

    const details = document.createElement("div");
    details.classList.add("jay-helpers-card-details");
    details.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.2rem;">
        <p style="margin:0;"><strong>${detail.name}</strong></p>
        ${meta ? `<p style="margin:0; font-size:0.9em; opacity:0.9;">${meta}</p>` : ""}
        ${description}
      </div>`;
    return details;
  };

  const renderCard = async (detail) => {
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.gap = "0.5rem";
    wrapper.style.alignItems = "flex-start";
    wrapper.append(renderCardButton(detail), await renderCardDetails(detail));
    return wrapper;
  };

  const detailsWrapper = document.createElement("div");
  detailsWrapper.classList.add("jay-helpers-card-chat-details");
  detailsWrapper.style.display = "flex";
  detailsWrapper.style.flexDirection = "column";
  detailsWrapper.style.gap = "0.5rem";
  detailsWrapper.style.marginTop = "0.5rem";
  for (const detail of detailsToRender) {
    detailsWrapper.append(await renderCard(detail));
  }

  contentNode.append(detailsWrapper);
  await persistCardDetailsToChatMessage(message, cardDetails);
};

/**
 * Called when Foundry has been initialized.
 */
const initHook = () => {
  log('Initialize settings');

  Object.values(SETTINGS)
    .forEach((s) => {
      log('register', s);
      game.settings.register(MODULE_ID, s.id, {
        name: game.i18n.localize(`${MODULE_ID}.settings.${s.id}.name`),
        hint: game.i18n.localize(`${MODULE_ID}.settings.${s.id}.hint`),
        config: true,
        ...s,
      });
    });

  // Update bloodied icon
  CONFIG.DND5E.bloodied.img = `modules/${MODULE_ID}/images/bleeding-wound.svg`;

  registerHorizontalCardHandSheet();

  Hooks.on("renderChatMessageHTML", enrichCardChatMessage);
};

/**
 * Called when Foundry is ready to go.
 */
const readyHook = () => {
  log('Ready');

  Hooks.on('dnd5e.preUseActivity', preUseActivity);
  Hooks.on('dnd5e.postUseActivity', postUseActivity);
  Hooks.on('dnd5e.preRollAttackV2', preRollAttack);
  Hooks.on('dnd5e.rollAttackV2', rollAttack);
  Hooks.on("renderItemSheet5e2", removeIdentifyButton);
  Hooks.on("dnd5e.getItemContextOptions", removeIdentifyMenu);
  Hooks.on("preCreateActiveEffect", preCreateActiveEffect);
  Hooks.on('dnd5e.applyDamage', applyDamage);
  Hooks.on("applyTokenStatusEffect", applyTokenStatusEffect);
  Hooks.on("dealCards", captureDealtCardDetails);
  Hooks.on("passCards", capturePassedCardDetails);
  Hooks.on("drawCards", captureDrawnCardDetails);
  Hooks.on("createCard", captureCreatedCardDetails);
  Hooks.on("preCreateChatMessage", addCardDetailsToChatMessage);
};

Hooks.once('init', initHook);
Hooks.once('ready', readyHook);
