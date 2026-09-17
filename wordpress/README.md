# Northfield Studio demo site

A WordPress plugin that builds **Northfield Studio**, a small agency website. It is the starting point for the WordPress → Strapi migration tutorial.

---

## Highlights

- Built only from free plugins on wordpress.org, with public-domain images.
- Content is stored the way real sites store it: post types in Custom Post Type UI, fields in ACF, layouts in Elementor.
- Includes the problems migrations actually hit (see [What makes it hard to migrate](#what-makes-it-hard-to-migrate)).
- Creates everything in under a minute, and removes it just as cleanly.

---

## Quick start

You need [Local](https://localwp.com) (free, macOS / Windows / Linux).

1. Download [`northfield-local-site.zip`](https://github.com/PaulBratslavsky/wordpress-to-strapi-demo/releases/latest/download/northfield-local-site.zip). Leave it zipped.
2. In Local, click **+**, drag the zip onto the *import a site* box, name the site `northfield`, choose **Preferred**, and click **Import site**.
3. Click **WP Admin** and log in as `admin` / `password`.

The theme, plugins, content and the migration helper are already in the zip. To rebuild it from a running site, run `./wordpress/build-local-site.sh`, then check it with `./wordpress/test-local-site.sh` before publishing.

### Building it from the plugin instead

Use this on any WordPress 6.5+ install, or if you want to see how the site is put together.

1. **Create the site.** In Local, click **+ → Create a new site**, name it `northfield`, choose **Preferred**, and set an admin username and password. Then click **WP Admin**.
2. **Install the theme.** Go to **Appearance → Themes → Add New**, search for **Inspiro**, then **Install** and **Activate**.
3. **Install the plugins.** Go to **Plugins → Add New**, then install and activate each of these:
   - Elementor
   - WPZOOM Portfolio
   - Custom Post Type UI
   - Advanced Custom Fields
4. **Install the demo plugin.** Go to **Plugins → Add New → Upload Plugin**, choose `northfield-demo.zip`, then click **Activate**.
5. **Create the content.** Go to **Tools → Northfield Demo** and click **Create demo content**.

Visit the site: you should see the Northfield Studio home page.

> **Where's `northfield-demo.zip`?** Build it with `./wordpress/build-plugin-zip.sh`. The script writes `wordpress/dist/northfield-demo.zip`.

### Using the command line instead

In Local, right-click the site → **Open site shell**, then run:

```bash
wp theme install inspiro --activate
wp plugin install elementor wpzoom-portfolio custom-post-type-ui advanced-custom-fields --activate
wp plugin install /path/to/northfield-demo.zip --activate
wp northfield seed
```

---

## Prepare the site for migration

The migration reads WordPress through its REST API. The Local site zip already includes the helper plugin, so if you imported it you only need step 2. Before you run it:

1. **Install the helper plugin.** Download [`strapi-migration-helper.zip`](https://github.com/PaulBratslavsky/wordpress-to-strapi-demo/releases/latest/download/strapi-migration-helper.zip), then in WP Admin go to **Plugins → Add Plugin → Upload Plugin**, choose the zip, and click **Install Now** and **Activate Plugin**.

   It makes the hidden content types and fields readable. Deactivate and delete it when you're done. To build the zip yourself, run `./wordpress/build-helper-zip.sh`.
2. **Create an application password.** In WP Admin, go to **Users → Profile → Application Passwords**, enter `strapi-migration`, click **Add**, and copy the password. Local sites accept application passwords over plain HTTP. Other hosts require HTTPS.

---

## What's in the site

| Content | Count | Built with |
|---|---|---|
| Pages | 8 | Block editor; **Home** and **About** use Elementor; **Careers** is a child page of About |
| Blog posts | 9 | Block editor, one classic-editor post; 7 published, 1 draft, 1 scheduled, 1 sticky |
| Services | 5 | Custom Post Type UI + ACF |
| Projects | 6 | WPZOOM Portfolio + ACF |
| Team members | 4 | Custom Post Type UI + ACF |
| Testimonials | 4 | Custom Post Type UI + ACF (not public) |
| Categories, tags, portfolio types, industries, departments | 28 terms | Core, WPZOOM Portfolio, Custom Post Type UI |
| Images | 30 | Media library, with alt text |
| Authors, menus, comments | 3, 2, 5 | Core |

---

## What makes it hard to migrate

Each of these is there on purpose.

| Problem | Where |
|---|---|
| Post type hidden from the REST API | **Team** (and its **Department** taxonomy) has `show_in_rest` off |
| Custom fields hidden from the REST API | The **Project details** ACF field group has *Show in REST API* off (ACF's default) |
| Nested field data | Projects use an ACF **Group** field, stored as flattened `results_*` meta |
| Relationships between entries | Services ↔ projects, testimonials → projects, posts → services |
| Page-builder layouts | Home and About are Elementor layouts, not plain content |
| Legacy content | *Our New Studio Space* is classic-editor HTML with `[caption]`, `[gallery]`, a bare YouTube URL and a leftover `[contact-form-7]` shortcode from a removed plugin |
| Rich blocks | Galleries, embeds, tables, code, columns, media & text, details, nested lists |
| URLs | Absolute internal links, a link and a hotlinked image from an old domain that no longer exists |
| Publishing states | A draft with no slug, a scheduled post, a sticky post |
| Unicode and entities | `Food & Drink`, `We’re`, `Inês` |

---

## Remove or rebuild

- **WP Admin:** go to **Tools → Northfield Demo** and click **Remove demo content**.
- **WP-CLI:** run `wp northfield reset`. To rebuild from scratch, run `wp northfield seed --force`.

Removal deletes everything the plugin created: entries, images, terms, menus, authors, and the Custom Post Type UI and ACF definitions.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Local says *"The archive has no wp-content folder"* | You dragged in `northfield-demo.zip`, which is a plugin. Local's import box takes `northfield-local-site.zip`. |
| **Tools → Northfield Demo** lists missing plugins | Install and activate the plugins named in the notice, then reload the page. |
| No **Application Passwords** section on the profile page | The site isn't on HTTPS and isn't marked as a local environment. Local sets `WP_ENVIRONMENT_TYPE` to `local` for you. On other hosts, enable HTTPS. |

---

## Credits

- Photos: [CC0](https://creativecommons.org/publicdomain/zero/1.0/) via [Openverse](https://openverse.org). See [`assets/images/CREDITS.md`](northfield-demo/assets/images/CREDITS.md).
- Northfield Studio, its clients, team and email domains are fictional.
- The plugin is licensed GPL-2.0-or-later.
