import type { Schema, Struct } from '@strapi/strapi';

export interface SectionsCode extends Struct.ComponentSchema {
  collectionName: 'components_sections_codes';
  info: {
    description: 'Migrated from WordPress';
    displayName: 'Code';
    icon: 'code';
  };
  attributes: {
    code: Schema.Attribute.Text;
    language: Schema.Attribute.String;
  };
}

export interface SectionsCta extends Struct.ComponentSchema {
  collectionName: 'components_sections_ctas';
  info: {
    description: 'Migrated from WordPress';
    displayName: 'Cta';
    icon: 'cursor';
  };
  attributes: {
    heading: Schema.Attribute.String;
    label: Schema.Attribute.String;
    text: Schema.Attribute.Text;
    url: Schema.Attribute.String;
  };
}

export interface SectionsEmbed extends Struct.ComponentSchema {
  collectionName: 'components_sections_embeds';
  info: {
    description: 'Migrated from WordPress';
    displayName: 'Embed';
    icon: 'play';
  };
  attributes: {
    provider: Schema.Attribute.String;
    title: Schema.Attribute.String;
    url: Schema.Attribute.String;
  };
}

export interface SectionsFeature extends Struct.ComponentSchema {
  collectionName: 'components_sections_features';
  info: {
    description: 'Migrated from WordPress';
    displayName: 'Feature';
    icon: 'star';
  };
  attributes: {
    icon: Schema.Attribute.String;
    image: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
    text: Schema.Attribute.Text;
    title: Schema.Attribute.String;
    url: Schema.Attribute.String;
  };
}

export interface SectionsGallery extends Struct.ComponentSchema {
  collectionName: 'components_sections_gallerys';
  info: {
    description: 'Migrated from WordPress';
    displayName: 'Gallery';
    icon: 'grid';
  };
  attributes: {
    caption: Schema.Attribute.String;
    images: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
  };
}

export interface SectionsHero extends Struct.ComponentSchema {
  collectionName: 'components_sections_heros';
  info: {
    description: 'Migrated from WordPress';
    displayName: 'Hero';
    icon: 'landscape';
  };
  attributes: {
    heading: Schema.Attribute.String;
    image: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
    label: Schema.Attribute.String;
    subheading: Schema.Attribute.Text;
    url: Schema.Attribute.String;
  };
}

export interface SectionsImage extends Struct.ComponentSchema {
  collectionName: 'components_sections_images';
  info: {
    description: 'Migrated from WordPress';
    displayName: 'Image';
    icon: 'picture';
  };
  attributes: {
    alt: Schema.Attribute.String;
    caption: Schema.Attribute.String;
    image: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
  };
}

export interface SectionsQuote extends Struct.ComponentSchema {
  collectionName: 'components_sections_quotes';
  info: {
    description: 'Migrated from WordPress';
    displayName: 'Quote';
    icon: 'quote';
  };
  attributes: {
    attribution: Schema.Attribute.String;
    quote: Schema.Attribute.Text;
  };
}

export interface SectionsRichText extends Struct.ComponentSchema {
  collectionName: 'components_sections_rich_texts';
  info: {
    description: 'Migrated from WordPress';
    displayName: 'Rich Text';
    icon: 'align-left';
  };
  attributes: {
    body: Schema.Attribute.Blocks;
  };
}

export interface SectionsTable extends Struct.ComponentSchema {
  collectionName: 'components_sections_tables';
  info: {
    description: 'Migrated from WordPress';
    displayName: 'Table';
    icon: 'grid';
  };
  attributes: {
    caption: Schema.Attribute.String;
    hasHeader: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    rows: Schema.Attribute.JSON;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'sections.code': SectionsCode;
      'sections.cta': SectionsCta;
      'sections.embed': SectionsEmbed;
      'sections.feature': SectionsFeature;
      'sections.gallery': SectionsGallery;
      'sections.hero': SectionsHero;
      'sections.image': SectionsImage;
      'sections.quote': SectionsQuote;
      'sections.rich-text': SectionsRichText;
      'sections.table': SectionsTable;
    }
  }
}
