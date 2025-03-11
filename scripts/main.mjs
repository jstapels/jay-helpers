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
};

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
  action: SETTINGS.TRACK_ACTION.id,
  bonus: SETTINGS.TRACK_BONUS.id,
  reaction: SETTINGS.TRACK_REACTION.id,
};

const actorInCombat = (actor) => {
  return game.combat?.getCombatantByActor(actor);
};

const isActionEnabled = (actionType) => {
  const settingId = actionSetting[actionType];
  if (!settingId) return false;
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

  // Make sure actor is IN the combat.
  if (!actorInCombat(actor)) return;

  // Check for any self effects and apply them.
  const selfTarget = activity.target?.affects?.type === "self";
  const selfRange = activity.range?.units === "self";
  const applySelfEffects = game.settings.get(MODULE_ID, SETTINGS.APPLY_SELF_EFFECTS.id);
  if ((selfTarget || selfRange) && activity.effects && applySelfEffects) {
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

  const warnNoTarget = game.settings.get(MODULE_ID, SETTINGS.WARN_NO_TARGET.id);
  if (warnNoTarget) {
    const target = game.user.targets?.size;
    const attack = activity.type === 'attack';
    if (attack && !target) {
      ui.notifications.warn(`Don't forget to target an enemy.`);
    }
  }
};

let preRollAttack = (config) => {
  const activity = config.subject;
  const item = activity?.parent?.parent;
  const actor = item?.actor;

  const combatant = game.combat?.getCombatantByActor(item.actor);
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

  const combatant = game.combat?.getCombatantByActor(item.actor);
  if (!combatant) return;

  // If attacking and it's not your turn, assume an opportunity attack, use reaction.
  const reactionEnable = game.settings.get(MODULE_ID, SETTINGS.TRACK_REACTION.id);
  if (reactionEnable && game.combat.combatant.id !== combatant.id) {
    ui.notifications.info("You're attacking when it's not your turn, assuming an Opportunity Attack.");
    createActionUsage(actor, item, 'reaction');
  }
};

let clearActionEffects = (actor) => {
  if (game.user !== game.users.activeGM) return;

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
  if (identifyIndex) {
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
    if (overlayBloodied) updates.flags = { core: { overlay: true } };
    effect.updateSource(updates);
  }
};

const applyDamage = async (actor, damage, options) => {
  log('applyDamage', actor, damage, options);

  // Only track combatants
  const combatant = game.combat?.getCombatantByActor(actor);
  if (!combatant) return;

  const applyUnconscious = game.settings.get(MODULE_ID, SETTINGS.SYNC_UNCONSCIOUS.id);
  if (actor.type === 'character' && applyUnconscious) {
    const unconsciousId = CONFIG.specialStatusEffects.UNCONSCIOUS;
    const isDead = actor.system.attributes?.hp?.value === 0;
    const isUnconscious = actor.statuses.has(unconsciousId);
    if (isDead !== isUnconscious) {
      await actor.toggleStatusEffect(unconsciousId);
    }
  }

  if (!game.user.isGM) return;

  const overlayBloodied = game.settings.get(MODULE_ID, SETTINGS.OVERLAY_BLOODIED.id);
  const applyDefeated = game.settings.get(MODULE_ID, SETTINGS.SYNC_DEFEATED.id);
  const important = actor.type !== 'npc' || actor.system.traits.important;
  if (!important && applyDefeated) {
    const isDead = actor.system.attributes?.hp?.value === 0;
    const isDefeated = combatant.defeated;
    log('Checking defeated', actor.name, isDead, isDefeated);
    if (isDefeated !== isDead) {
      const defeatedId = CONFIG.specialStatusEffects.DEFEATED;
      await combatant.update({ defeated: isDead });
      await actor.toggleStatusEffect(defeatedId, { overlay: true, active: isDead });
      const bloodied = actor.effects.get(dnd5e.documents.ActiveEffect5e.ID.BLOODIED);
      if (bloodied && overlayBloodied) {
        bloodied.setFlag('core', { overlay: !isDead });
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
      actor.update({ 'system.attributes.hp': { value: state ? 0 : 1, temp: 0 } });
      const bloodied = actor.effects.get(dnd5e.documents.ActiveEffect5e.ID.BLOODIED);
      if (bloodied && overlayBloodied) {
        bloodied.setFlag('core', { overlay: !isDead });
      }
    }
  }
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
        requiresReload: false,
        config: true,
        ...s,
      });
    });

  // Update bloodied icon
  CONFIG.DND5E.bloodied.icon = `modules/${MODULE_ID}/images/bleeding-wound.svg`;
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
  Hooks.on('combatTurnChange', combatTurnChange);
  Hooks.on("renderItemSheet5e2", removeIdentifyButton);
  Hooks.on("dnd5e.getItemContextOptions", removeIdentifyMenu);
  Hooks.on("preCreateActiveEffect", preCreateActiveEffect);
  Hooks.on('dnd5e.applyDamage', applyDamage);
  Hooks.on("applyTokenStatusEffect", applyTokenStatusEffect);
};

Hooks.once('init', initHook);
Hooks.once('ready', readyHook);

