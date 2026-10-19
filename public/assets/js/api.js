/* ============================================================
   Thinkneering Hub - data layer.
   Pages never talk to the server directly; they call Api.*.
   Every method posts JSON to /api/rpc/<name> on the same site
   (the Cloudflare Worker in worker/src). The names and the
   parameters are those of the database functions of the earlier site, so the
   pages did not change in the move.
   ============================================================ */
(function () {
  "use strict";
  var BASE = new URL("../../api/rpc/", document.currentScript.src).href;   // works from any folder depth

  function rpc(fn, args) {
    return fetch(BASE + fn, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args || {})
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (!res.ok) {
          var msg = (body && (body.message || body.error)) || ("Request failed (" + res.status + ")");
          throw new Error(msg);
        }
        if (body && body.ok === false) throw new Error(body.error || "Request failed");
        return body;
      });
    }, function () {
      throw new Error("Cannot reach the server. Check your network connection.");
    });
  }

  var api = {
    register: function (d) { return rpc("app_register", { p_username: d.username, p_full_name: d.fullName, p_password: d.password, p_team_note: d.teamNote || "" }); },
    login: function (u, p) { return rpc("app_login", { p_username: u, p_password: p }); },
    me: function (t) { return rpc("app_me", { p_token: t }); },
    logout: function (t) { return rpc("app_logout", { p_token: t }); },
    changePassword: function (t, o, n) { return rpc("app_change_password", { p_token: t, p_old: o, p_new: n }); },
    updateProfile: function (t, d) { return rpc("app_update_profile", { p_token: t, p_full_name: d.fullName, p_avatar: d.avatar || "" }); },
    adminOverview: function (t) { return rpc("app_admin_overview", { p_token: t }); },
    adminSetUser: function (t, d) { return rpc("app_admin_set_user", { p_token: t, p_user_id: d.id, p_status: d.status, p_role: d.role, p_categories: d.categories, p_edit_tools: d.editTools || [], p_admin_categories: d.adminCategories == null ? null : d.adminCategories }); },
    adminResetPassword: function (t, id, pw) { return rpc("app_admin_reset_password", { p_token: t, p_user_id: id, p_new_password: pw }); },
    adminDeleteUser: function (t, id) { return rpc("app_admin_delete_user", { p_token: t, p_user_id: id }); },
    adminSaveTool: function (t, d) { return rpc("app_admin_save_tool", { p_token: t, p_id: d.id, p_category_id: d.category_id, p_name: d.name, p_description: d.description, p_path: d.path, p_status: d.status, p_sort: d.sort, p_editable: !!d.editable }); },
    // Compliance Maker library
    cmOptions: function (t) { return rpc("cm_options", { p_token: t }); },
    cmSaveRun: function (t, d) { return rpc("cm_save_run", { p_token: t, p_factory_id: d.factoryId, p_source: d.source, p_file_name: d.fileName || "", p_lines: d.lines, p_project_id: d.projectId || null }); },
    cmAdminLines: function (t, d) { return rpc("cm_admin_lines", { p_token: t, p_factory_id: d.factoryId, p_status: d.status || "open", p_search: d.search || "", p_limit: d.limit || 100, p_offset: d.offset || 0,
      p_part: d.part === "" || d.part == null ? null : +d.part, p_topic: d.topic || "", p_client_type: d.clientType || "", p_client_name: d.clientName || "", p_project_code: d.projectCode || "" }); },
    cmAdminSaveAnswer: function (t, id, c, r, comments) { return rpc("cm_admin_save_answer", { p_token: t, p_line_id: id, p_compliance: c, p_remarks: r, p_comments: comments == null ? null : comments }); },
    cmAdminDeleteLine: function (t, id) { return rpc("cm_admin_delete_line", { p_token: t, p_line_id: id }); },
    cmResetLibrary: function (t, d) { return rpc("cm_reset_library", { p_token: t, p_product_id: d.productId, p_factory_id: d.factoryId || null, p_with_projects: !!d.withProjects }); },
    cmAdminImport: function (t, d) { return rpc("cm_admin_import", { p_token: t, p_factory_id: d.factoryId, p_file_name: d.fileName || "", p_rows: d.rows }); },
    cmAdminRuns: function (t, d) { return rpc("cm_admin_runs", { p_token: t, p_limit: (d && d.limit) || 50, p_offset: (d && d.offset) || 0 }); },
    cmAdminExport: function (t, factoryId, projectCode) { return rpc("cm_admin_export", { p_token: t, p_factory_id: factoryId, p_project_code: projectCode || "" }); },
    // Datasheet Notes row mapping
    dnRules: function (t, productId) { return rpc("dn_get_rules", { p_token: t, p_product_id: productId }); },
    dnAddRows: function (t, d) { return rpc("dn_add_rows", { p_token: t, p_product_id: d.productId, p_rows: d.rows || [] }); },
    dnAdminSaveRules: function (t, d) { return rpc("dn_admin_save_rules", { p_token: t, p_product_id: d.productId, p_show_unmapped: d.showUnmapped !== false, p_rules: d.rules || [], p_remove: d.remove || [] }); },
    // Product Options (tree of sections, options and notes per factory)
    poCollect: function (t, d) { return rpc("po_collect", { p_token: t, p_product_id: d.productId, p_items: d.items || [] }); },
    poTree: function (t, factoryId) { return rpc("po_get_tree", { p_token: t, p_factory_id: factoryId }); },
    poAdminSaveExtra: function (t, d) { return rpc("po_admin_save_extra", { p_token: t, p_factory_id: d.factoryId, p_id: d.id || null, p_section: d.section, p_row_key: d.key || "", p_kind: d.kind, p_body: d.body }); },
    poAdminDeleteExtra: function (t, id) { return rpc("po_admin_delete_extra", { p_token: t, p_id: id }); },
    prRunSelection: function (t, runId) { return rpc("pr_run_selection", { p_token: t, p_run_id: runId }); },
    poAdminApprove: function (t, d) { return rpc("po_admin_approve", { p_token: t, p_factory_id: d.factoryId, p_items: d.items || null, p_all: !!d.all, p_approve: !!d.approve }); },
    poAdminSetHidden: function (t, d) { return rpc("po_admin_set_hidden", { p_token: t, p_factory_id: d.factoryId, p_row_key: d.key, p_value_key: d.valueKey || "", p_hidden: !!d.hidden, p_model: d.model || "" }); },
    // Projects (every piece of work is saved under one) and the review of users' compliance answers
    prOptions: function (t) { return rpc("pr_options", { p_token: t }); },
    prList: function (t) { return rpc("pr_list", { p_token: t }); },
    prSave: function (t, d) { return rpc("pr_save", { p_token: t, p_id: d.id || null, p_name: d.name, p_client_type: d.clientType, p_client_name: d.clientName, p_region: d.region }); },
    prGet: function (t, id) { return rpc("pr_get", { p_token: t, p_id: id }); },
    prDelete: function (t, id) { return rpc("pr_delete", { p_token: t, p_id: id }); },
    prShareGet: function (t, id) { return rpc("pr_share_get", { p_token: t, p_id: id }); },
    prShareSet: function (t, id, userIds) { return rpc("pr_share_set", { p_token: t, p_id: id, p_user_ids: userIds || [] }); },
    prExport: function (t, id) { return rpc("pr_export", { p_token: t, p_id: id }); },
    prNoteSave: function (t, d) { return rpc("pr_note_save", { p_token: t, p_project_id: d.projectId, p_product_id: d.productId, p_file_names: d.fileNames || "", p_columns: d.columns, p_rows: d.rows, p_factory: d.factory || "" }); },
    prNoteGet: function (t, id) { return rpc("pr_note_get", { p_token: t, p_note_id: id }); },
    prRunGet: function (t, id) { return rpc("pr_run_get", { p_token: t, p_run_id: id }); },
    prRunSaveLine: function (t, d) { return rpc("pr_run_save_line", { p_token: t, p_run_id: d.run, p_seq: d.seq, p_compliance: d.compliance || "", p_remarks: d.remarks || "", p_check: d.check == null ? null : d.check }); },
    prRunFillSection: function (t, d) { return rpc("pr_run_fill_section", { p_token: t, p_run_id: d.run, p_seq: d.seq, p_compliance: d.compliance, p_replace: !!d.replace, p_check: d.check == null ? null : d.check }); },
    prRunSaveReview: function (t, d) { return rpc("pr_run_save_review", { p_token: t, p_run_id: d.run, p_seq: d.seq, p_text: d.text || "", p_check: d.check == null ? null : d.check }); },
    prRunSaveComment: function (t, d) { return rpc("pr_run_save_comment", { p_token: t, p_run_id: d.run, p_seq: d.seq, p_comments: d.comments || "", p_check: d.check == null ? null : d.check }); },
    prRunSplit: function (t, d) { return rpc("pr_run_split", { p_token: t, p_run_id: d.run, p_seq: d.seq, p_rows: d.rows, p_check: d.check == null ? null : d.check }); },
    prRunJoin: function (t, d) { return rpc("pr_run_join", { p_token: t, p_run_id: d.run, p_seq: d.seq, p_check: d.check == null ? null : d.check }); },
    prDeleteRecord: function (t, kind, id) { return rpc("pr_delete_record", { p_token: t, p_kind: kind, p_id: id }); },
    prSubmitAnswers: function (t, runId, rows) { return rpc("pr_submit_answers", { p_token: t, p_run_id: runId, p_rows: rows }); },
    prReviewList: function (t, d) { return rpc("pr_review_list", { p_token: t, p_status: (d && d.status) || "pending", p_limit: (d && d.limit) || 100, p_offset: (d && d.offset) || 0 }); },
    prReviewDecide: function (t, d) { return rpc("pr_review_decide", { p_token: t, p_run_id: d.run, p_seq: d.seq, p_decision: d.decision, p_compliance: d.compliance == null ? null : d.compliance, p_remarks: d.remarks == null ? null : d.remarks, p_line_id: d.lineId || null }); },
    prAdminSummary: function (t) { return rpc("pr_admin_summary", { p_token: t }); },
    // Maps (product knowledge as a tree: branches, notes, special notes, links, images)
    mpList: function (t) { return rpc("mp_list", { p_token: t }); },
    mpCreate: function (t, d) { return rpc("mp_create", { p_token: t, p_name: d.name, p_share: d.share || "private", p_kind: d.kind || "knowledge" }); },
    mpGet: function (t, id) { return rpc("mp_get", { p_token: t, p_map_id: id }); },
    mpMapSave: function (t, d) { return rpc("mp_map_save", { p_token: t, p_map_id: d.id, p_name: d.name == null ? null : d.name, p_share: d.share == null ? null : d.share, p_kind: d.kind == null ? null : d.kind }); },
    mpDelete: function (t, id) { return rpc("mp_delete", { p_token: t, p_map_id: id }); },
    mpNodeAdd: function (t, parentId, title) { return rpc("mp_node_add", { p_token: t, p_parent_id: parentId, p_title: title }); },
    mpNodeSave: function (t, id, patch) { return rpc("mp_node_save", { p_token: t, p_node_id: id, p_patch: patch }); },
    mpNodeVerify: function (t, d) { return rpc("mp_node_verify", { p_token: t, p_node_id: d.id, p_verified: d.verified !== false, p_deep: !!d.deep }); },
    mpNodeMove: function (t, id, dir) { return rpc("mp_node_move", { p_token: t, p_node_id: id, p_dir: dir }); },
    mpNodeDelete: function (t, id) { return rpc("mp_node_delete", { p_token: t, p_node_id: id }); },
    mpImport: function (t, parentId, items) { return rpc("mp_import", { p_token: t, p_parent_id: parentId, p_items: items }); },
    mpNodeImages: function (t, nodeId) { return rpc("mp_node_images", { p_token: t, p_node_id: nodeId }); },
    mpImageGet: function (t, id) { return rpc("mp_image_get", { p_token: t, p_image_id: id }); },
    mpImageAdd: function (t, d) { return rpc("mp_image_add", { p_token: t, p_node_id: d.nodeId, p_data: d.data, p_thumb: d.thumb, p_caption: d.caption || "" }); },
    mpImageSave: function (t, id, caption) { return rpc("mp_image_save", { p_token: t, p_image_id: id, p_caption: caption || "" }); },
    mpImageDelete: function (t, id) { return rpc("mp_image_delete", { p_token: t, p_image_id: id }); },
    mpSearch: function (t, q) { return rpc("mp_search", { p_token: t, p_q: q }); },
    // AI review (admins): drafts answers for every clause of a project record, a batch per call
    aiReviewRun: function (t, d) { return rpc("ai_review_run", { p_token: t, p_run_id: d.run, p_limit: d.limit || 10, p_replace: !!d.replace, p_since: d.since || null, p_skip: d.skip || [], p_no_model: !!d.noModel }); },
    aiReviewStatus: function (t, runId) { return rpc("ai_review_status", { p_token: t, p_run_id: runId }); },
    aiCheck: function (t) { return rpc("ai_check", { p_token: t }); },
    aiReviewClear: function (t, runId) { return rpc("ai_review_clear", { p_token: t, p_run_id: runId }); },
    // focus mode: proposals for up to 3 clauses of a record (everyone who can open it)
    aiSuggest: function (t, runId, seqs) { return rpc("ai_suggest", { p_token: t, p_run_id: runId, p_seqs: seqs }); },
    // Compliance review > AI rules (admins and the super user): the maps the AI reads, a clause to try, quality
    aiMapGet: function (t, d) { return rpc("ai_map_get", { p_token: t, p_product_id: d.productId, p_factory_id: d.factoryId || null }); },
    aiMapLink: function (t, d) { return rpc("ai_map_link", { p_token: t, p_product_id: d.productId, p_factory_id: d.factoryId || null, p_map_id: d.mapId || null, p_role: d.role || "rulebook" }); },
    aiMapCreate: function (t, d) { return rpc("ai_map_create", { p_token: t, p_product_id: d.productId, p_factory_id: d.factoryId || null, p_name: d.name || "" }); },
    aiEval: function (t, d) { return rpc("ai_eval", { p_token: t, p_product_id: d.productId, p_factory_id: d.factoryId, p_check: d.check, p_n: d.n, p_seen: d.seen || [] }); },
    aiEvalHistory: function (t, d) { return rpc("ai_eval_history", { p_token: t, p_product_id: d.productId, p_factory_id: d.factoryId }); },
    aiMapUpgrade: function (t, d) { return rpc("ai_map_upgrade", { p_token: t, p_product_id: d.productId, p_factory_id: d.factoryId || null }); },
    aiLearn: function (t, productId) { return rpc("ai_learn", { p_token: t, p_product_id: productId }); },
    aiTry: function (t, d) { return rpc("ai_try", { p_token: t, p_product_id: d.productId, p_factory_id: d.factoryId, p_clause: d.clause, p_section: d.section || "", p_part: d.part || 0 }); },
    aiQuality: function (t, productId) { return rpc("ai_quality", { p_token: t, p_product_id: productId }); },
    adminSaveCategory: function (t, d) { return rpc("app_admin_save_category", { p_token: t, p_id: d.id, p_name: d.name, p_description: d.description, p_sort: d.sort, p_is_default: d.is_default }); }
  };

  window.Api = api;
  window.Api.isDemo = false;
})();
