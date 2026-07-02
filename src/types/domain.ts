export type Route =
  | "initial"
  | "home"
  | "categories"
  | "products"
  | "promotions"
  | "launches"
  | "contact"
  | "detail"
  | "login"
  | "signup"
  | "about"
  | "admin";

export type Role = "VISITANTE" | "CLIENTE" | "REPRESENTANTE" | "ADMIN";

export type Produto = {
  id: string;
  nome: string;
  slug?: string | null;
  codigoInterno?: string | null;
  categoriaId?: string | null;
  marcaId?: string | null;
  descricaoCurta?: string | null;
  descricaoCompleta?: string | null;
  ean?: string | null;
  ncm?: string | null;
  caixaMaster?: string | null;
  imagemPrincipal?: string | null;
  imagensExtras?: string[] | null;
  preco?: number | null;
  estoque?: number | null;
  condicaoComercial?: string | null;
  prazoEntrega?: string | null;
  fichaTecnica?: string | null;
  manualPdf?: string | null;
  observacaoComercial?: string | null;
  observacaoInterna?: string | null;
  margem?: number | null;
  ca?: string | null;
  ativo?: boolean | null;
  destaque?: boolean | null;
  ordem?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type Categoria = { id: string; nome: string; slug?: string | null; descricao?: string | null; imagem?: string | null; ordem?: number | null; ativo?: boolean | null };
export type Marca = { id: string; nome: string; slug?: string | null; logo?: string | null; ativo?: boolean | null };
export type Aplicacao = { id: string; nome: string; slug?: string | null; tipo?: string | null; ativo?: boolean | null };
export type Usuario = { id: string; name: string; company?: string | null; email: string; role: Role; status: "PENDING" | "ACTIVE" | "INACTIVE"; notes?: string | null; phone?: string | null; cnpj?: string | null; address?: string | null; city?: string | null; state?: string | null; registrationNotes?: string | null; approvedAt?: string | null; approvedBy?: string | null; lastLoginAt?: string | null; createdAt?: string | null; updatedAt?: string | null; authUserId?: string | null };
export type Lead = { id: string; nome: string; empresa?: string | null; telefone?: string | null; email?: string | null; cidade?: string | null; estado?: string | null; produtoId?: string | null; mensagem?: string | null; origem?: string | null; status?: string | null; createdAt?: string | null };
export type Permission = { id: string; fieldKey: string; fieldLabel: string; visibleToVisitor: boolean; visibleToClient: boolean; visibleToRepresentative: boolean; visibleToAdmin: boolean };
export type SocialLinks = { instagram: string; linkedin: string; whatsapp: string; site: string };
export type MediaSettings = { initialImage: string; homeImage: string };
export type AboutSettings = { title: string; subtitle: string; body: string };
export type AuthSession = { access_token: string; user: { id: string; email?: string } };

export type AppData = {
  produtos: Produto[];
  categorias: Categoria[];
  marcas: Marca[];
  aplicacoes: Aplicacao[];
  usuarios: Usuario[];
  leads: Lead[];
  permissoes: Permission[];
};
