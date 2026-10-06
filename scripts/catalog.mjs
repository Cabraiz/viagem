import { writeFileSync } from 'node:fs';
import { classes } from '../src/classes.ts';

const lines = ['# As 36 classes de viagem', '', 'Catálogo da primeira versão de seleção. Habilidades abaixo são propostas de design; ainda não estão implementadas em combate. Atributos: Força / Agilidade / Malícia / Carisma.', ''];
for (const hero of classes) {
  lines.push(`## ${String(hero.art + 1).padStart(2, '0')}. ${hero.name}`, '', `**${hero.role}** · ${hero.subtitle}`, '', hero.description, '', `**${hero.skill}:** ${hero.skillDescription}`, '', `Atributos: ${hero.stats.join(' / ')}.`, '', `> ${hero.quote}`, '');
}
writeFileSync(new URL('../docs/classes.md', import.meta.url), lines.join('\n'));
