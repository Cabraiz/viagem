// Etapa 2b: the hero's idle S frame at HERO_PX (tower-art px) → final/refs/hero.png
import {hero} from '../refs-lib.mjs';import sharp from 'sharp';
const h=await hero();await sharp(h.data).png().toFile('evidence/NEW-20261025-ORQ-torres-ramo-a-postos/final/refs/hero.png');console.log(h.info.width,h.info.height);
