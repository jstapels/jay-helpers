# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Foundry VTT module for the D&D 5e system that provides quality-of-life enhancements for gameplay. The module is written in vanilla JavaScript (ES modules) and hooks into Foundry VTT and the dnd5e system APIs.

## Development Commands

### Linting
```bash
npm run lint          # Check for linting errors
npm run lint-fix      # Auto-fix linting errors
```

## Architecture

### Module Structure

The entire module is implemented as a single ES module file (`scripts/main.mjs`) that registers with Foundry VTT hooks. All functionality is implemented through hook callbacks that respond to Foundry and dnd5e system events.

### Core Components

**Settings System**: Module uses `SETTINGS` object to define all configuration options. Each setting has:
- `id`: Setting identifier
- `type`: Data type (typically Boolean)
- `default`: Default value
- `scope`: Either "client" (per-user) or "world" (global)
- Optional `requiresReload`: Whether changing requires page reload

**Hook Architecture**: Module exclusively uses Foundry's `Hooks` system to respond to events. Key hook points:
- `init`: Settings registration and CONFIG modifications (runs once during initialization)
- `ready`: Hook registration (runs once when Foundry is ready)
- `dnd5e.preUseActivity` / `dnd5e.postUseActivity`: Action tracking before/after item use
- `dnd5e.preRollAttackV2` / `dnd5e.rollAttackV2`: Attack roll tracking (opportunity attacks)
- `combatTurnChange`: Cleanup of expired action effects at turn change
- `deleteCombat`: Cleanup of all action effects when combat ends
- `dnd5e.applyDamage`: Damage tracking and status synchronization
- `applyTokenStatusEffect`: Status effect tracking
- `renderItemSheet5e2` / `dnd5e.getItemContextOptions`: UI modifications for item identification
- `preCreateActiveEffect`: Effect modifications (bloodied appearance)

### Key Features

**Action Tracking**: Creates temporary active effects on actors to track action/bonus action/reaction usage during combat. Effects are stored with module flags (`jay-helpers` namespace) including `actionType` and `warned` state. When an action type is already tracked, the effect name is updated to reflect the most recent triggering item and the warning state is reset. Cleanup happens automatically at turn changes via `combatTurnChange` hook and when combat ends via `deleteCombat` hook.

**Self Effect Application**: Automatically applies effects when an activity targets self, bypassing need for manual targeting. Checks both `activity.target.affects.type === "self"` and `activity.range.units === "self"`.

**Opportunity Attack Detection**: Detects attacks made when it's not the actor's turn and treats them as opportunity attacks that consume reactions.

**Status Synchronization**:
- NPCs: Syncs defeated status with 0 HP
- PCs/Important NPCs: Syncs unconscious status with 0 HP
- Only applies to combatants in active combat

**Bloodied Effect Customization**: Modifies the appearance of the bloodied effect via `preCreateActiveEffect` hook, checking for `dnd5e.documents.ActiveEffect5e.ID.BLOODIED`.

**Identification Prevention**: Removes the "Identify" button from item sheets and context menus for non-GM users on unidentified items.

### Global Variables

The module relies heavily on Foundry VTT globals defined in `eslint.config.mjs`:
- `game`: Main game instance with settings, combat, users, i18n
- `ui`: User interface (notifications)
- `Hooks`: Event system
- `CONFIG`: System configuration
- `dnd5e`: D&D 5e system API
- `canvas`, `Actor`, `ChatMessage`, etc.: Core Foundry document types

### Naming Conventions

- Constants: SCREAMING_SNAKE_CASE (e.g., `MODULE_ID`, `SETTINGS`)
- Functions: camelCase (e.g., `preUseActivity`, `actorInCombat`)
- Settings IDs: camelCase (e.g., `trackAction`, `applySelfEffects`)

### Module ID

All settings, flags, and module paths use the constant `MODULE_ID = 'jay-helpers'`. When adding new flags or settings, use this constant.

### Compatibility

- Foundry VTT: v12 minimum, v13 verified
- D&D 5e System: v4.0 minimum, v5.0 verified
