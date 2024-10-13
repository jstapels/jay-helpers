const MODULE_ID = 'jay-helpers';

// Setting keys
const SETTING_TRACK_ACTION = "trackAction";
const SETTING_TRACK_BONUS = "trackBonus";
const SETTING_TRACK_REACTION = "trackReaction";
const SETTING_TRACK_OPPORTUNITY = "trackOpportunity";

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
    label: 'Action - ',
    icon: `modules/${MODULE_ID}/images/action.svg`,
    description: 'Action taken',
    duration: { rounds: 1 },
  },
  bonus: {
    label: 'Bonus Action: ',
    icon: `modules/${MODULE_ID}/images/bonus.svg`,
    description: 'Action taken',
    duration: { rounds: 1 },
  },
  reaction: {
    label: 'Reaction: ',
    icon: `modules/${MODULE_ID}/images/reaction.svg`,
    description: 'Action taken',
    duration: { rounds: 1 },
  },
};

const actionSetting = {
  action: SETTING_TRACK_ACTION,
  bonus: SETTING_TRACK_BONUS,
  reaction: SETTING_TRACK_REACTION,
};

const checkActionUsage = (actor, item, actionType) => {
  const existingEffect = actor.effects.find((e) => {
    const effectActionType = e.getFlag(MODULE_ID, 'actionType');
    return effectActionType === actionType;
  });

  // Create if no existing effect.
  if (!existingEffect) {
    return true;
  }

  const warned = existingEffect.getFlag(MODULE_ID, 'warned');
  if (!warned) {
    const usedItemName = existingEffect.name.replace(actionConfig[actionType].label, '');
    ui.notifications.warn(`You already used your ${actionType} on ${usedItemName}, try again if you really want to use it.`);
    existingEffect.setFlag(MODULE_ID, 'warned', true);
    return false;
  }
    
  return true;
};

const createActionUsage = (actor, item, actionType) => {
  // Create if no existing effect.
  const effectData = {
    ...actionConfig[actionType],
    origin: actor,
    flags: {
      [MODULE_ID]: {
        actionType,
        warned: false,
      },
    },
  };
  effectData.label += item.name;
  // effectData.duration.startRound = game.combat?.round;
  // effectData.duration.startTurn = game.combat?.turn;
  actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
};

let preUseActivity = (activity) => {
  log('Checking activity', activity);

  // Skip if combat isn't active.
  if (!game.combat) return true;

  // Only proceed if owner of token got this event.
  const item = activity?.parent?.parent;
  const actor = item?.actor;
  if (!actor?.isOwner) return true;

  // Make sure actor is IN the combat.
  const combatant = game.combat.getCombatantByActor(actor);
  if (!combatant) return true;

  const actionType = activity.activation?.type;

  // Make sure there's a config for it.
  if (!actionConfig[actionType]) {
    return true;
  }

  const settingId = actionSetting[actionType];
  if (!settingId || !game.settings.get(MODULE_ID, settingId)) {
    return true;
  }

  if (!checkActionUsage(actor, item, actionType)) {
    return false;
  }

  createActionUsage(actor, item, actionType);
  return true;
};

let preRollAttack = (config) => {
  const activity = config.subject;
  const item = activity?.parent?.parent;
  const actor = item?.actor;
  if (!actor?.isOwner) return true;
  if (!game.combat?.combatant) return true;

  const combatant = game.combat.getCombatantByActor(item.actor);
  if (!combatant) return true;

  // If attacking and it's not owner's turn, assume an opportunity attack, check reaction.
  if (game.combat.combatant.id !== combatant.id) {
    return checkActionUsage(actor, item, 'reaction');
  }

  return true;
};

let rollAttack = (rolls, data) => {
  const activity = data.subject;
  const item = activity?.parent?.parent;
  const actor = item?.actor;
  if (!actor?.isOwner) return;
  if (!game.combat?.combatant) return;

  const combatant = game.combat.getCombatantByActor(item.actor);
  if (!combatant) return;

  // If attacking and it's not your turn, assume an opportunity attack, use reaction.
  const reactionEnable = game.settings.get(MODULE_ID, SETTING_TRACK_REACTION);
  if (reactionEnable && game.combat.combatant.id !== combatant.id) {
    ui.notifications.info("You're attacking when it's not your turn, assuming an Opportunity Attack.");
    createActionUsage(actor, item, 'reaction');
  }
};

let clearActionEffects = (actor) => {
  const existingEffectIds = actor.effects
    .filter((e) => e.getFlag(MODULE_ID, 'actionType'))
    .filter((e) => (e.duration.startRound < game.combat.round)
      || (e.duration.startRound === game.combat.round && e.duration.startTurn < game.combat.turn))
    .map((e) => e.id);
  actor.deleteEmbeddedDocuments('ActiveEffect', existingEffectIds);
};

let combatTurnChange = (combat) => {
  if (!combat.combatant.isOwner) return;

  let actor = combat.combatant?.actor;
  if (!actor) return;

  clearActionEffects(actor);
};


/**
 * Called when Foundry has been initialized.
 */
const initHook = () => {
  log('Initialize settings');

  game.settings.register(MODULE_ID, SETTING_TRACK_ACTION, {
    name: game.i18n.localize(`${MODULE_ID}.settings.trackAction.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.trackAction.hint`),
    scope: 'client',
    config: true,
    requiresReload: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SETTING_TRACK_BONUS, {
    name: game.i18n.localize(`${MODULE_ID}.settings.trackBonus.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.trackBonus.hint`),
    scope: 'client',
    config: true,
    requiresReload: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTING_TRACK_REACTION, {
    name: game.i18n.localize(`${MODULE_ID}.settings.trackReaction.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.trackReaction.hint`),
    scope: 'client',
    config: true,
    requiresReload: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTING_TRACK_OPPORTUNITY, {
    name: game.i18n.localize(`${MODULE_ID}.settings.trackOpportunity.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.trackOpportunity.hint`),
    scope: 'client',
    config: true,
    requiresReload: true,
    type: Boolean,
    default: true,
  });
};

/**
 * Called when Foundry is ready to go.
 */
const readyHook = () => {
  log('Ready');

  Hooks.on('dnd5e.preUseActivity', preUseActivity);
  Hooks.on('dnd5e.preRollAttackV2', preRollAttack);
  Hooks.on('dnd5e.rollAttackV2', rollAttack);
  Hooks.on('combatTurnChange', combatTurnChange);
};

Hooks.once('init', initHook);
Hooks.once('ready', readyHook);

