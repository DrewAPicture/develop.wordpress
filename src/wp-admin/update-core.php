<?php
/**
 * Update Core administration panel.
 *
 * @package WordPress
 * @subpackage Administration
 */

/** WordPress Administration Bootstrap */
require_once( dirname( __FILE__ ) . '/admin.php' );

wp_enqueue_style( 'plugin-install' );
wp_enqueue_script( 'plugin-install' );
wp_enqueue_script( 'updates' );
add_thickbox();

if ( is_multisite() && ! is_network_admin() ) {
	wp_redirect( network_admin_url( 'update-core.php' ) );
	exit();
}

if ( ! current_user_can( 'update_core' ) && ! current_user_can( 'update_themes' ) && ! current_user_can( 'update_plugins' ) )
	wp_die( __( 'You do not have sufficient permissions to update this site.' ) );

/**
 * Upgrade WordPress core display.
 *
 * @since 2.7.0
 *
 * @global WP_Filesystem_Base $wp_filesystem Subclass
 *
 * @param bool $reinstall
 */
function do_core_upgrade( $reinstall = false ) {
	global $wp_filesystem;

	include_once( ABSPATH . 'wp-admin/includes/class-wp-upgrader.php' );

	if ( $reinstall )
		$url = 'update-core.php?action=do-core-reinstall';
	else
		$url = 'update-core.php?action=do-core-upgrade';
	$url = wp_nonce_url($url, 'upgrade-core');

	$version = isset( $_POST['version'] )? $_POST['version'] : false;
	$locale = isset( $_POST['locale'] )? $_POST['locale'] : 'en_US';
	$update = find_core_update( $version, $locale );
	if ( !$update )
		return;

	// Allow relaxed file ownership writes for User-initiated upgrades when the API specifies
	// that it's safe to do so. This only happens when there are no new files to create.
	$allow_relaxed_file_ownership = ! $reinstall && isset( $update->new_files ) && ! $update->new_files;

?>
	<div class="wrap">
	<h1><?php _e( 'Update WordPress' ); ?></h1>
<?php

	if ( false === ( $credentials = request_filesystem_credentials( $url, '', false, ABSPATH, array( 'version', 'locale' ), $allow_relaxed_file_ownership ) ) ) {
		echo '</div>';
		return;
	}

	if ( ! WP_Filesystem( $credentials, ABSPATH, $allow_relaxed_file_ownership ) ) {
		// Failed to connect, Error and request again
		request_filesystem_credentials( $url, '', true, ABSPATH, array( 'version', 'locale' ), $allow_relaxed_file_ownership );
		echo '</div>';
		return;
	}

	if ( $wp_filesystem->errors->get_error_code() ) {
		foreach ( $wp_filesystem->errors->get_error_messages() as $message )
			show_message($message);
		echo '</div>';
		return;
	}

	if ( $reinstall )
		$update->response = 'reinstall';

	add_filter( 'update_feedback', 'show_message' );

	$upgrader = new Core_Upgrader();
	$result = $upgrader->upgrade( $update, array(
		'allow_relaxed_file_ownership' => $allow_relaxed_file_ownership
	) );

	if ( is_wp_error($result) ) {
		show_message($result);
		if ( 'up_to_date' != $result->get_error_code() && 'locked' != $result->get_error_code() )
			show_message( __('Installation Failed') );
		echo '</div>';
		return;
	}

	show_message( __('WordPress updated successfully') );
	show_message( '<span class="hide-if-no-js">' . sprintf( __( 'Welcome to WordPress %1$s. You will be redirected to the About WordPress screen. If not, click <a href="%2$s">here</a>.' ), $result, esc_url( self_admin_url( 'about.php?updated' ) ) ) . '</span>' );
	show_message( '<span class="hide-if-js">' . sprintf( __( 'Welcome to WordPress %1$s. <a href="%2$s">Learn more</a>.' ), $result, esc_url( self_admin_url( 'about.php?updated' ) ) ) . '</span>' );
	?>
	</div>
	<script type="text/javascript">
	window.location = '<?php echo self_admin_url( 'about.php?updated' ); ?>';
	</script>
	<?php
}

/**
 * @since 2.7.0
 */
function do_dismiss_core_update() {
	$version = isset( $_POST['version'] )? $_POST['version'] : false;
	$locale = isset( $_POST['locale'] )? $_POST['locale'] : 'en_US';
	$update = find_core_update( $version, $locale );
	if ( !$update )
		return;
	dismiss_core_update( $update );
	wp_redirect( wp_nonce_url('update-core.php?action=upgrade-core', 'upgrade-core') );
	exit;
}

/**
 * @since 2.7.0
 */
function do_undismiss_core_update() {
	$version = isset( $_POST['version'] )? $_POST['version'] : false;
	$locale = isset( $_POST['locale'] )? $_POST['locale'] : 'en_US';
	$update = find_core_update( $version, $locale );
	if ( !$update )
		return;
	undismiss_core_update( $version, $locale );
	wp_redirect( wp_nonce_url('update-core.php?action=upgrade-core', 'upgrade-core') );
	exit;
}

$action = isset($_GET['action']) ? $_GET['action'] : 'upgrade-core';

$upgrade_error = false;
if ( ( 'do-theme-upgrade' == $action || ( 'do-plugin-upgrade' == $action && ! isset( $_GET['plugins'] ) ) )
	&& ! isset( $_POST['checked'] ) ) {
	$upgrade_error = $action == 'do-theme-upgrade' ? 'themes' : 'plugins';
	$action = 'upgrade-core';
}

$title = __('WordPress Updates');
$parent_file = 'index.php';

$updates_overview  = '<p>' . __( 'On this screen, you can update to the latest version of WordPress, as well as update your themes, plugins, and translations from the WordPress.org repositories.' ) . '</p>';
$updates_overview .= '<p>' . __( 'If an update is available, you&#8127;ll see a notification appear in the Toolbar and navigation menu.' ) . ' ' . __( 'Keeping your site updated is important for security. It also makes the internet a safer place for you and your readers.' ) . '</p>';

get_current_screen()->add_help_tab( array(
	'id'      => 'overview',
	'title'   => __( 'Overview' ),
	'content' => $updates_overview
) );

$updates_howto  = '<p>' . __( '<strong>WordPress</strong> &mdash; Updating your WordPress installation is a simple one-click procedure: just <strong>click on the &#8220;Update Now&#8221; button</strong> when you are notified that a new version is available.' ) . ' ' . __( 'In most cases, WordPress will automatically apply maintenance and security updates in the background for you.' ) . '</p>';
$updates_howto .= '<p>' . __( '<strong>Themes and Plugins</strong> &mdash; To update individual themes or plugins from this screen, use the checkboxes to make your selection, then <strong>click on the appropriate &#8220;Update&#8221; button</strong>. To update all of your themes or plugins at once, you can check the box at the top of the section to select all before clicking the update button.' ) . '</p>';

if ( 'en_US' != get_locale() ) {
	$updates_howto .= '<p>' . __( '<strong>Translations</strong> &mdash; The files translating WordPress into your language are updated for you whenever any other updates occur. But if these files are out of date, you can <strong>click the &#8220;Update Translations&#8221;</strong> button.' ) . '</p>';
}

get_current_screen()->add_help_tab( array(
	'id'      => 'how-to-update',
	'title'   => __( 'How to Update' ),
	'content' => $updates_howto
) );

get_current_screen()->set_help_sidebar(
	'<p><strong>' . __('For more information:') . '</strong></p>' .
	'<p>' . __( '<a href="https://codex.wordpress.org/Dashboard_Updates_Screen" target="_blank">Documentation on Updating WordPress</a>' ) . '</p>' .
	'<p>' . __( '<a href="https://wordpress.org/support/" target="_blank">Support Forums</a>' ) . '</p>'
);

if ( 'upgrade-core' == $action ) {
	// Force a update check when requested
	$force_check = ! empty( $_GET['force-check'] );
	wp_version_check( array(), $force_check );

	// Do the (un)dismiss actions before headers, so that they can redirect.
	if ( isset( $_GET['dismiss'] ) || isset( $_GET['undismiss'] ) ) {
		$version = isset( $_GET['version'] ) ? sanitize_text_field( wp_unslash( $_GET['version'] ) ) : false;
		$locale  = isset( $_GET['locale'] ) ? sanitize_text_field( wp_unslash( $_GET['locale'] ) ) : 'en_US';

		$update = find_core_update( $version, $locale );

		if ( $update ) {
			if ( isset( $_GET['dismiss'] ) ) {
				dismiss_core_update( $update );
			} else {
				undismiss_core_update( $version, $locale );
			}
		}
	}

	require_once(ABSPATH . 'wp-admin/admin-header.php');
	?>
	<div class="wrap">
	<h1><?php _e( 'WordPress Updates' ); ?></h1>
	<?php
	if ( $upgrade_error ) {
		echo '<div class="error"><p>';
		if ( $upgrade_error == 'themes' )
			_e('Please select one or more themes to update.');
		else
			_e('Please select one or more plugins to update.');
		echo '</p></div>';
	}

	echo '<p>';
	/* translators: %1 date, %2 time. */
	printf( __( 'Last checked on %1$s at %2$s.' ), date_i18n( __( 'F j, Y' ) ), date_i18n( __( 'g:i a' ) ) );
	echo ' <a href="' . esc_url( self_admin_url('update-core.php?force-check=1') ) . '">' . __( 'Check Again' ) . '</a>';
	echo '</p>';

	global $wp_version, $required_php_version, $required_mysql_version;
	?>
	<div class="wordpress-updates-table">
		<?php
		$updates_table = _get_list_table( 'WP_Updates_List_Table' );
		$updates_table->prepare_items();

		if ( $updates_table->has_available_updates() ) :
			$updates_table->display();
		else : ?>
		<div class="notice notice-success inline">
			<p>
				<strong><?php _e( 'Everything is up to date.' ); ?></strong>
				<?php
				if ( wp_http_supports( array( 'ssl' ) ) ) {
					require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

					$upgrader = new WP_Automatic_Updater();

					$future_minor_update = (object) array(
						'current'       => $wp_version . '.1.next.minor',
						'version'       => $wp_version . '.1.next.minor',
						'php_version'   => $required_php_version,
						'mysql_version' => $required_mysql_version,
					);

					if ( $upgrader->should_update( 'core', $future_minor_update, ABSPATH ) ) {
						echo ' ' . __( 'Future security updates will be applied automatically.' );
					}
				}
				?>
			</p>
		</div>
		<?php endif; ?>
	</div>

	<?php
	$core_updates = (array) get_core_updates();

	if ( ! empty( $core_updates ) ) :
		$update = array_pop( $core_updates );

		if ( 'en_US' === $update->locale &&
		     'en_US' === get_locale() ||
		     (
			     $update->packages->partial &&
			     $wp_version === $update->partial_version &&
			     1 === count( $core_updates )
		     )
		) {
			$version_string = $update->current;
		} else {
			$version_string = sprintf( '%s&ndash;<code>%s</code>', $update->current, $update->locale );
		}

		if ( ! isset( $update->response ) || 'latest' === $update->response ) :
		?>
			<div class="wordpress-reinstall-card card" data-type="core" data-reinstall="true" data-version="<?php echo esc_attr( $update->current ); ?>" data-locale="<?php echo esc_attr( $update->locale ); ?>">
				<h2><?php _e( 'Need to re-install WordPress?' ); ?></h2>
				<p>
					<?php
						/* translators: %s: WordPress version */
						printf( __( 'If you need to re-install version %s, you can do so here.' ), $version_string );
					?>
				</p>

				<form method="post" action="update-core.php?action=do-core-reinstall" name="upgrade" class="upgrade">
					<?php wp_nonce_field( 'upgrade-core' ); ?>
					<input name="version" value="<?php echo esc_attr( $update->current ); ?>" type="hidden"/>
					<input name="locale" value="<?php echo esc_attr( $update->locale ); ?>" type="hidden"/>
					<p>
						<button type="submit" name="upgrade" class="button update-link"><?php esc_attr_e( 'Re-install Now' ); ?></button>
					</p>
				</form>
			</div>
		<?php
		endif;
	endif;

	/**
	 * Fires after the core, plugin, and theme update tables.
	 *
	 * @since 2.9.0
	 */
	do_action( 'core_upgrade_preamble' );

	echo '</div>';

	wp_print_request_filesystem_credentials_modal();

	include(ABSPATH . 'wp-admin/admin-footer.php');

} elseif ( 'do-core-upgrade' == $action || 'do-core-reinstall' == $action ) {

	if ( ! current_user_can( 'update_core' ) )
		wp_die( __( 'You do not have sufficient permissions to update this site.' ) );

	check_admin_referer('upgrade-core');

	require_once(ABSPATH . 'wp-admin/admin-header.php');
	if ( 'do-core-reinstall' == $action )
		$reinstall = true;
	else
		$reinstall = false;

	if ( isset( $_POST['upgrade'] ) )
		do_core_upgrade($reinstall);

	include(ABSPATH . 'wp-admin/admin-footer.php');

} elseif ( 'do-plugin-upgrade' == $action ) {

	if ( ! current_user_can( 'update_plugins' ) )
		wp_die( __( 'You do not have sufficient permissions to update this site.' ) );

	check_admin_referer('upgrade-core');

	if ( isset( $_GET['plugins'] ) ) {
		$plugins = explode( ',', $_GET['plugins'] );
	} elseif ( isset( $_POST['checked'] ) ) {
		$plugins = (array) $_POST['checked'];
	} else {
		wp_redirect( admin_url('update-core.php') );
		exit;
	}

	$url = 'update.php?action=update-selected&plugins=' . urlencode(implode(',', $plugins));
	$url = wp_nonce_url($url, 'bulk-update-plugins');

	$title = __('Update Plugins');

	require_once(ABSPATH . 'wp-admin/admin-header.php');
	echo '<div class="wrap">';
	echo '<h1>' . __( 'Update Plugins' ) . '</h1>';
	echo '<iframe src="', $url, '" style="width: 100%; height: 100%; min-height: 750px;" frameborder="0" title="' . esc_attr__( 'Update progress' ) . '"></iframe>';
	echo '</div>';
	include(ABSPATH . 'wp-admin/admin-footer.php');

} elseif ( 'do-theme-upgrade' == $action ) {

	if ( ! current_user_can( 'update_themes' ) )
		wp_die( __( 'You do not have sufficient permissions to update this site.' ) );

	check_admin_referer('upgrade-core');

	if ( isset( $_GET['themes'] ) ) {
		$themes = explode( ',', $_GET['themes'] );
	} elseif ( isset( $_POST['checked'] ) ) {
		$themes = (array) $_POST['checked'];
	} else {
		wp_redirect( admin_url('update-core.php') );
		exit;
	}

	$url = 'update.php?action=update-selected-themes&themes=' . urlencode(implode(',', $themes));
	$url = wp_nonce_url($url, 'bulk-update-themes');

	$title = __('Update Themes');

	require_once(ABSPATH . 'wp-admin/admin-header.php');
	?>
	<div class="wrap">
		<h1><?php _e( 'Update Themes' ); ?></h1>
		<iframe src="<?php echo $url ?>" style="width: 100%; height: 100%; min-height: 750px;" frameborder="0" title="<?php esc_attr_e( 'Update progress' ); ?>"></iframe>
	</div>
	<?php
	include(ABSPATH . 'wp-admin/admin-footer.php');

} elseif ( 'do-translation-upgrade' == $action ) {

	if ( ! current_user_can( 'update_core' ) && ! current_user_can( 'update_plugins' ) && ! current_user_can( 'update_themes' ) )
		wp_die( __( 'You do not have sufficient permissions to update this site.' ) );

	check_admin_referer( 'upgrade-translations' );

	require_once( ABSPATH . 'wp-admin/admin-header.php' );
	include_once( ABSPATH . 'wp-admin/includes/class-wp-upgrader.php' );

	$url = 'update-core.php?action=do-translation-upgrade';
	$nonce = 'upgrade-translations';
	$title = __( 'Update Translations' );
	$context = WP_LANG_DIR;

	$upgrader = new Language_Pack_Upgrader( new Language_Pack_Upgrader_Skin( compact( 'url', 'nonce', 'title', 'context' ) ) );
	$result = $upgrader->bulk_upgrade();

	require_once( ABSPATH . 'wp-admin/admin-footer.php' );

} elseif ( 'do-all-upgrade' === $action ) {

	if ( ! current_user_can( 'update_core' ) && ! current_user_can( 'update_plugins' ) && ! current_user_can( 'update_themes' ) ) {
		wp_die( __( 'You do not have sufficient permissions to update this site.' ) );
	}

	check_admin_referer( 'upgrade-core' );

	require_once( ABSPATH . 'wp-admin/admin-header.php' );

	// Update themes.
	$themes = array_keys( get_theme_updates() );

	if ( ! empty( $themes ) ) {
		$url = 'update.php?action=update-selected-themes&themes=' . urlencode( implode( ',', $themes ) );
		$url = wp_nonce_url( $url, 'bulk-update-themes' );
		?>
		<div class="wrap">
			<h1><?php _e( 'Update Themes' ); ?></h1>
			<iframe src="<?php echo $url ?>" style="width: 100%; height: 100%; min-height: 750px;" frameborder="0" title="<?php esc_attr_e( 'Update progress' ); ?>"></iframe>
		</div>
		<?php
	}

	// Update plugins.
	$plugins = array_keys( get_plugin_updates() );

	if ( ! empty( $plugins ) ) {
		$url = 'update.php?action=update-selected&plugins=' . urlencode( implode( ',', $plugins ) );
		$url = wp_nonce_url( $url, 'bulk-update-plugins' );
		?>
		<div class="wrap">
			<h1><?php _e( 'Update Plugins' ); ?></h1>
			<iframe src="<?php echo $url ?>" style="width: 100%; height: 100%; min-height: 750px;" frameborder="0" title="<?php esc_attr_e( 'Update progress' ); ?>"></iframe>
		</div>
		<?php
	}

	include_once( ABSPATH . 'wp-admin/includes/class-wp-upgrader.php' );

	// Update translations.
	$url     = 'update-core.php?action=do-translation-upgrade';
	$nonce   = 'upgrade-translations';
	$title   = __( 'Update Translations' );
	$context = WP_LANG_DIR;

	$upgrader = new Language_Pack_Upgrader( new Language_Pack_Upgrader_Skin( compact( 'url', 'nonce', 'title', 'context' ) ) );
	$upgrader->bulk_upgrade();

	// Update core.
	do_core_upgrade();

	include( ABSPATH . 'wp-admin/admin-footer.php' );

} else {
	/**
	 * Fires for each custom update action on the WordPress Updates screen.
	 *
	 * The dynamic portion of the hook name, `$action`, refers to the
	 * passed update action. The hook fires in lieu of all available
	 * default update actions.
	 *
	 * @since 3.2.0
	 */
	do_action( "update-core-custom_{$action}" );
}
