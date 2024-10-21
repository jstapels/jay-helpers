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

const isActionEnabled = (actionType) => {
  const settingId = actionSetting[actionType];
  return game.settings.get(MODULE_ID, settingId);
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
  actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
};

let preUseActivity = (activity) => {
  log('Checking activity', activity);

  const item = activity?.parent?.parent;
  const actor = item?.actor;
  const combatant = game.combat?.getCombatantByActor(actor);

  // Make sure actor is IN the combat.
  if (!combatant) return true;

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

  if (!checkActionUsage(actor, item, actionType)) {
    return false;
  }

  return true;
};

const applyActorSelfEffects = (actor, effects) => {
  // Apply associated effects.
  effects.forEach((effect) => {
    log("Activate effect", effect);
    // Enable an existing effect on the target if it originated from this effect
    const existingEffect = actor.effects.find((e) => e.origin === origin.uuid);
    if (existingEffect) {
      existingEffect.update({
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
      actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
    }
  });
};

const postUseActivity = (activity) => {
  log('Activity used', activity);

  const item = activity?.parent?.parent;
  const actor = item?.actor;
  const combatant = game.combat?.getCombatantByActor(actor);

  // Make sure actor is IN the combat.
  if (!combatant) return;

  // Check for any self effects and apply them.
  const selfTarget = activity.target?.affects?.type === "self";
  const selfRange = activity.range?.units === "self";
  if ((selfTarget || selfRange) && activity.effects) {
    log("Found self effects to apply");
    const effects = activity.effects.map((e) => e.effect);
    applyActorSelfEffects(actor, effects);
  }

  // Apply action effect, if there's a config for it and it's enabled.
  const actionType = activity.activation?.type;
  if (isActionEnabled(actionType)) {
    log(`A tracked action ${actionType} was used`);
    createActionUsage(actor, item, actionType);
  }
};

let preRollAttack = (config) => {
  const activity = config.subject;
  const item = activity?.parent?.parent;
  const actor = item?.actor;
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
  if (!game.user.isGM) return;
  const existingEffectIds = actor.effects
    .filter((e) => e.getFlag(MODULE_ID, 'actionType'))
    .filter((e) => (e.duration.startRound < game.combat.round)
      || (e.duration.startRound === game.combat.round && e.duration.startTurn < game.combat.turn))
    .map((e) => e.id);
  actor.deleteEmbeddedDocuments('ActiveEffect', existingEffectIds);
};

let combatTurnChange = (combat) => {
  let actor = combat.combatant?.actor;
  if (!actor) return;

  clearActionEffects(actor);
};

// Remove Identify button at top of Item Sheet
const removeIdentifyButton = (sheet, [html]) => {
  if (game.user.isGM) return;
  const unidentified = sheet.item.system.identified === false;
  if (!unidentified) return;
  html.querySelectorAll(".pseudo-header-button.state-toggle.toggle-identified")
    .forEach((n) => n.remove());
};


// Remove Identify button from Item Context menu on Actor Sheet
const removeIdentifyMenu = (item, buttons) => {
  if (game.user.isGM) return;
  const unidentified = item.system.identified === false;
  if (!unidentified) return;
  const identifyIndex = buttons.findIndex((opt) => opt.name === 'DND5E.Identify');
  if (identifyIndex) {
    buttons.splice(identifyIndex, 1);
  }
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
  Hooks.on('dnd5e.preUseActivity', postUseActivity);
  Hooks.on('dnd5e.preRollAttackV2', preRollAttack);
  Hooks.on('dnd5e.rollAttackV2', rollAttack);
  Hooks.on('combatTurnChange', combatTurnChange);
  Hooks.on("renderItemSheet5e2", removeIdentifyButton);
  Hooks.on("dnd5e.getItemContextOptions", removeIdentifyMenu);
};

Hooks.once('init', initHook);
Hooks.once('ready', readyHook);

