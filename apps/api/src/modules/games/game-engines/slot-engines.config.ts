import { createSlotEngine } from './slot-generic.engine';

const configs = [
  { slug: 'pharaohs-legacy', title: "Pharaoh's Legacy", description: 'Ancient Egyptian treasure kingdom slot.', tagline: 'Free-play — no real money', symbols: ['Pharaoh','Ankh','Scarab','Eye of Horus','Golden Mask','Pyramid'], reels: 5, rows: 4 },
  { slug: 'atlantis-treasure', title: 'Atlantis Treasure', description: 'Underwater lost civilization slot.', tagline: 'Free-play — no real money', symbols: ['Mermaid','Trident','Pearl','Sea King','Coral','Treasure Chest'], reels: 5, rows: 4 },
  { slug: 'neon-cyber-rush', title: 'Neon Cyber Rush', description: 'Futuristic cyberpunk metropolis slot.', tagline: 'Free-play — no real money', symbols: ['Cyber Robot','Hacker','Neon Chip','Hologram','Energy Core'], reels: 6, rows: 4 },
  { slug: 'mystic-forest', title: 'Mystic Forest', description: 'Enchanted magical forest slot.', tagline: 'Free-play — no real money', symbols: ['Fairy','Dragon Egg','Magic Tree','Crystal','Owl','Mushroom'], reels: 5, rows: 4 },
  { slug: 'samurai-fortune', title: 'Samurai Fortune', description: 'Japanese samurai kingdom slot.', tagline: 'Free-play — no real money', symbols: ['Samurai','Katana','Dragon','Sakura','Temple','Mask'], reels: 5, rows: 5 },
  { slug: 'cosmic-odyssey', title: 'Cosmic Odyssey', description: 'Intergalactic space adventure slot.', tagline: 'Free-play — no real money', symbols: ['Astronaut','Alien','Planet','UFO','Star','Space Station'], reels: 5, rows: 4 },
  { slug: 'dragons-kingdom', title: "Dragon's Kingdom", description: 'Medieval dragon kingdom slot.', tagline: 'Free-play — no real money', symbols: ['Dragon','Knight','Crown','Sword','Castle','Treasure'], reels: 5, rows: 4 },
  { slug: 'tropical-paradise', title: 'Tropical Paradise', description: 'Tropical island paradise slot.', tagline: 'Free-play — no real money', symbols: ['Pineapple','Coconut','Toucan','Waterfall','Parrot','Treasure'], reels: 5, rows: 4 },
  { slug: 'steampunk-revolution', title: 'Steampunk Revolution', description: 'Mechanical steampunk civilization slot.', tagline: 'Free-play — no real money', symbols: ['Gear','Pocket Watch','Airship','Inventor','Steam Engine'], reels: 5, rows: 4 },
  { slug: 'frozen-empire', title: 'Frozen Empire', description: 'Frozen crystal empire slot.', tagline: 'Free-play — no real money', symbols: ['Ice Queen','Crystal','Snow Wolf','Frozen Crown','Snowflake'], reels: 5, rows: 4 },
];

export const SLOT_ENGINES = configs.map(createSlotEngine);
