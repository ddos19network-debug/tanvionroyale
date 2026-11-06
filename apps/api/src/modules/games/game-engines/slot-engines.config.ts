import { createSlotEngine } from './slot-generic.engine';

const configs = [
  { slug: 'royale-pharaoh', title: "ROYALE PHARAOH", description: 'Ancient Egyptian treasure kingdom slot.', tagline: 'Free-play — no real money', symbols: ['Pharaoh','Ankh','Scarab','Eye of Horus','Golden Mask','Pyramid'], reels: 5, rows: 4 },
  { slug: 'neon-cyber-rush', title: "ROYALE NEON CYBER RUSH", description: 'Futuristic cyberpunk metropolis slot.', tagline: 'Free-play — no real money', symbols: ['Cyber Robot','Hacker','Neon Chip','Hologram','Energy Core'], reels: 6, rows: 4 },
  { slug: 'mystic-forest', title: "ROYALE MYSTIC FOREST", description: 'Enchanted magical forest slot.', tagline: 'Free-play — no real money', symbols: ['Fairy','Dragon Egg','Magic Tree','Crystal','Owl','Mushroom'], reels: 5, rows: 4 },
  { slug: 'samurai-fortune', title: "ROYALE SAMURAI FORTUNE", description: 'Japanese samurai kingdom slot.', tagline: 'Free-play — no real money', symbols: ['Samurai','Katana','Dragon','Sakura','Temple','Mask'], reels: 5, rows: 5 },
  { slug: 'cosmic-odyssey', title: "ROYALE COSMIC ODYSSEY", description: 'Intergalactic space adventure slot.', tagline: 'Free-play — no real money', symbols: ['Astronaut','Alien','Planet','UFO','Star','Space Station'], reels: 5, rows: 4 },
  { slug: 'dragons-kingdom', title: "ROYALE DRAGON'S KINGDOM", description: 'Medieval dragon kingdom slot.', tagline: 'Free-play — no real money', symbols: ['Dragon','Knight','Crown','Sword','Castle','Treasure'], reels: 5, rows: 4 },
  { slug: 'tropical-paradise', title: "ROYALE TROPICAL PARADISE", description: 'Tropical island paradise slot.', tagline: 'Free-play — no real money', symbols: ['Pineapple','Coconut','Toucan','Waterfall','Parrot','Treasure'], reels: 5, rows: 4 },
  { slug: 'steampunk-revolution', title: "ROYALE STEAMPUNK REVOLUTION", description: 'Mechanical steampunk civilization slot.', tagline: 'Free-play — no real money', symbols: ['Gear','Pocket Watch','Airship','Inventor','Steam Engine'], reels: 5, rows: 4 },
  { slug: 'frozen-empire', title: "ROYALE FROZEN EMPIRE", description: 'Frozen crystal empire slot.', tagline: 'Free-play — no real money', symbols: ['Ice Queen','Crystal','Snow Wolf','Frozen Crown','Snowflake'], reels: 5, rows: 4 },
  { slug: 'royale-atlantis', title: "ROYALE ATLANTIS", description: 'Lost ocean kingdom slot.', tagline: 'Free-play — no real money', symbols: ['Ocean King','Mermaid Queen','Golden Trident','Royal Pearl','Atlantis Palace','Sea Dragon','Dolphin','Sea Turtle','Seahorse','Magic Jellyfish','Starfish','Octopus','Royal Crab','Coral Reef','Royal Shell','Ocean Coin','Ocean Crystal','Tidal Wild','Atlantis Gate','Treasure Chest','Kraken Emblem'], reels: 7, rows: 7 },
];

export const SLOT_ENGINES = configs.map(createSlotEngine);
