import type { AboutSettings, SocialLinks } from "../types/domain";

export const colors = {
  navy: "#021126",
  yellow: "#FCB900",
  ink: "#07142A",
  muted: "#6F7480",
  line: "#E8EAF0",
  soft: "#F6F7F9",
  red: "#CF102D",
  green: "#16A34A",
  white: "#FFFFFF"
};

export const defaultSocialLinks: SocialLinks = {
  instagram: "https://instagram.com/briland",
  linkedin: "https://linkedin.com/company/briland",
  whatsapp: "https://wa.me/5521973636891",
  site: "https://briland.com.br"
};

export const defaultAbout: AboutSettings = {
  title: "Sobre a Briland",
  subtitle: "Qualidade e confiança em soluções automotivas.",
  body: "A Briland oferece soluções automotivas com foco em qualidade, atendimento ágil e produtos desenvolvidos para acompanhar as necessidades do mercado."
};
