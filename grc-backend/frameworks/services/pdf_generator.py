"""
Edge-GRC High-Fidelity Audit Report PDF Generation Engine.

Generates executive-ready compliance packages utilizing ReportLab Flowables:
- Executive summary with dynamic compliance posture scorecards and pie charts.
- Control evaluation matrices, evidentiary proofs, and testing plans.
- Risk register heatmaps and POA&M remediation task breakdowns.
- AES-128/StandardEncryption password protection and confidential running headers/footers.
"""

import io
import base64
import html
from django.utils import timezone
from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.lib.pagesizes import letter
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.platypus import Image as RLImage
from reportlab.lib.utils import ImageReader
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.graphics.charts.piecharts import Pie


def esc(value):
    """Escapes user-supplied strings before passing them to ReportLab's XML Paragraph parser."""
    return html.escape(str(value or ''), quote=True)


def make_paragraph_table(data, col_widths, body_style, header_style):
    """Wrap table text to its cell width and repeat the header on each page."""
    formatted_data = []
    for row_index, row in enumerate(data):
        style = header_style if row_index == 0 else body_style
        formatted_data.append([
            cell if isinstance(cell, Paragraph) else Paragraph(
                esc(cell).replace('\n', '<br/>'),
                style,
            )
            for cell in row
        ])
    return Table(formatted_data, colWidths=col_widths, repeatRows=1)


def make_pie_chart(metrics_list, drawing_width=150):
    """Render a pie chart with a separate legend so small-slice labels stay readable."""
    metrics = [(label, value, color) for label, value, color in metrics_list if value > 0]
    drawing = Drawing(drawing_width, 100)

    if metrics:
        pie = Pie()
        pie.x = max(0, (drawing_width - 170) / 2)
        pie.y = 10
        pie.width = 80
        pie.height = 80
        pie.labels = []
        pie.slices.strokeWidth = 0.5
        pie.data = [value for _, value, _ in metrics]

        for index, (_, _, color) in enumerate(metrics):
            pie.slices[index].fillColor = colors.HexColor(color)

        drawing.add(pie)

        legend_x = pie.x + pie.width + 6
        first_label_y = (100 - 8) / 2 + (len(metrics) - 1) * 7
        for index, (label, value, color) in enumerate(metrics):
            label_y = first_label_y - index * 14
            drawing.add(Rect(
                legend_x,
                label_y - 1,
                6,
                6,
                fillColor=colors.HexColor(color),
                strokeColor=None,
            ))
            drawing.add(String(
                legend_x + 9,
                label_y,
                f"{label} ({value})",
                fontName="Helvetica",
                fontSize=7,
            ))
    else:
        drawing.add(String(
            drawing_width / 2,
            46,
            "No data",
            textAnchor="middle",
            fontName="Helvetica",
            fontSize=8,
        ))

    return drawing


def make_confidential_footer(company_name):
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont('Helvetica-Bold', 9)
        canvas.setStrokeColorRGB(0.8, 0.8, 0.8)
        canvas.line(inch, 0.9 * inch, letter[0] - inch, 0.9 * inch)

        generated = f"Generated: {timezone.now().strftime('%Y-%m-%d')}"
        available_width = letter[0] - (2 * inch)
        original_company = str(company_name or '')
        company = original_company
        while company and stringWidth(
            f"{company} | {generated}", 'Helvetica-Bold', 9
        ) > available_width:
            company = company[:-1]
        if company != original_company:
            company = company.rstrip()
            while company and stringWidth(
                f"{company}... | {generated}", 'Helvetica-Bold', 9
            ) > available_width:
                company = company[:-1]
            company = f"{company.rstrip()}..."
        footer_text = f"{company} | {generated}" if company else generated
        canvas.drawString(inch, 0.63 * inch, footer_text)

        canvas.setFillColor(colors.HexColor('#ef4444')) 
        canvas.drawCentredString(letter[0] / 2.0, 0.39 * inch, "CONFIDENTIAL - DO NOT DISTRIBUTE")
        canvas.setFillColor(colors.black)
        canvas.drawRightString(letter[0] - inch, 0.39 * inch, f"Page {doc.page}")
        canvas.restoreState()
    return footer

def generate_audit_pdf(export_data, company_name, export_password=None, logo_data_url=None):
    """
    Takes a massive export_data payload and draws a formal PDF report.
    Returns the raw bytes stream of the PDF file.
    """
    pdf_buffer = io.BytesIO()
    
    enc = None
    if export_password:
        enc = StandardEncryption(
            userPassword=export_password, 
            ownerPassword=export_password, 
            canPrint=1, 
            canModify=0, 
            canCopy=0, 
            canAnnotate=0
        )
    
    doc = BaseDocTemplate(
        pdf_buffer, 
        pagesize=letter, 
        topMargin=0.5*inch, 
        bottomMargin=1.2*inch, 
        encrypt=enc 
    )
    
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='normal')
    
    dynamic_footer = make_confidential_footer(company_name)
    template = PageTemplate(id='audit_report', frames=frame, onPage=dynamic_footer)
    doc.addPageTemplates([template])
    
    styles = getSampleStyleSheet()
    centered_style = ParagraphStyle(name="Centered", parent=styles['Normal'], alignment=TA_CENTER)
    table_body_style = ParagraphStyle(
        name="ReportTableBody",
        parent=styles['Normal'],
        fontName="Helvetica",
        fontSize=8,
        leading=10,
        splitLongWords=1,
    )
    table_header_style = ParagraphStyle(
        name="ReportTableHeader",
        parent=table_body_style,
        fontName="Helvetica-Bold",
        textColor=colors.whitesmoke,
    )
    elements = []

    if logo_data_url and 'base64,' in logo_data_url:
        try:
            format_part, base64_part = logo_data_url.split('base64,')
            image_data = base64.b64decode(base64_part)
            img_io = io.BytesIO(image_data)
            
            img_reader = ImageReader(img_io)
            iw, ih = img_reader.getSize()
            aspect = ih / float(iw)
            
            target_width = 1.5 * inch
            target_height = target_width * aspect
            
            if target_height > 1.2 * inch:
                target_height = 1.2 * inch
                target_width = target_height / aspect

            logo_img = RLImage(img_io, width=target_width, height=target_height)
            logo_img.hAlign = 'LEFT'
            elements.append(logo_img)
            elements.append(Spacer(1, 12))
        except Exception as e:
            print(f"Failed to process logo for PDF: {e}")

    safe_company = esc(company_name)
    meta = export_data.get('metadata', {})
    elements.append(Paragraph(f"{safe_company} - Compliance Audit Report", styles['Title']))
    elements.append(Spacer(1, 12))
    
    elements.append(Paragraph("<b>Target Scope &amp; Assessment Boundaries</b>", styles['Heading3']))
    elements.append(Paragraph(f"<b>Organization:</b> {safe_company}", styles['Normal']))
    elements.append(Paragraph(f"<b>Framework Assessed:</b> {esc(meta.get('target_framework'))}", styles['Normal']))
    elements.append(Paragraph(f"<b>Environment Boundary:</b> {esc(meta.get('assessment_boundary'))}", styles['Normal']))
    elements.append(Paragraph(f"<b>Generated At:</b> {esc(meta.get('generated_at'))}", styles['Normal']))
    elements.append(Paragraph(f"<b>Generated By:</b> {esc(meta.get('generated_by'))}", styles['Normal']))
    elements.append(Spacer(1, 16))

    if export_data.get('summary'):
        elements.append(Paragraph("Organization Compliance Summary", styles['Heading2']))
        elements.append(Spacer(1, 6))
        summary = export_data['summary']
        
        elements.append(Paragraph(f"• <b>Total Controls:</b> {summary['total_controls']}", styles['Normal']))
        elements.append(Paragraph(f"• <b>Compliance Score:</b> {summary['compliance_score']}%", styles['Normal']))
        elements.append(Spacer(1, 12))
        
        if summary['total_controls'] > 0:
            status_metrics = [
                ("Pass", summary['passing_controls'], '#22c55e'), 
                ("Wait", summary['awaiting_controls'], '#f59e0b'), 
                ("Fail", summary['failing_controls'], '#ef4444'), 
                ("Un-eval", summary['not_evaluated'], '#64748b'),
                ("N/A", summary.get('not_applicable', 0), '#cbd5e1')
            ]
            design_metrics = [("Effective", summary['design_effective'], '#22c55e'), ("Flawed", summary['design_deficient'], '#ef4444'), ("Untested", summary['design_not_tested'], '#64748b')]
            op_metrics = [("Effective", summary['operating_effective'], '#22c55e'), ("Failed", summary['operating_deficient'], '#ef4444'), ("Untested", summary['operating_not_tested'], '#64748b')]
            
            chart_table_data = [
                [Paragraph("<b>Overall Status</b>", centered_style), Paragraph("<b>Design Eval</b>", centered_style), Paragraph("<b>Operational Eval</b>", centered_style)],
                [make_pie_chart(status_metrics), make_pie_chart(design_metrics), make_pie_chart(op_metrics)]
            ]
            
            chart_table = Table(chart_table_data, colWidths=[155, 155, 155])
            chart_table.setStyle(TableStyle([
                ('ALIGN', (0,0), (-1,-1), 'CENTER'),
                ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                ('BOTTOMPADDING', (0,0), (-1,0), 6),
            ]))
            elements.append(chart_table)

        if summary.get('total_risks', 0) > 0:
            elements.append(Spacer(1, 16))
            elements.append(Paragraph("<b>Enterprise Risk Posture (Inherent vs. Residual)</b>", styles['Heading3']))
            elements.append(Spacer(1, 6))
            
            inherent_metrics = [
                ("Critical", summary['risk_inherent_critical'], '#ef4444'), 
                ("High", summary['risk_inherent_high'], '#f97316'), 
                ("Medium", summary['risk_inherent_medium'], '#eab308'), 
                ("Low", summary['risk_inherent_low'], '#22c55e')
            ]
            residual_metrics = [
                ("Critical", summary['risk_residual_critical'], '#ef4444'), 
                ("High", summary['risk_residual_high'], '#f97316'), 
                ("Medium", summary['risk_residual_medium'], '#eab308'), 
                ("Low", summary['risk_residual_low'], '#22c55e')
            ]
            
            risk_chart_table_data = [
                [Paragraph("<b>Inherent Risk Profile</b>", centered_style), Paragraph("<b>Residual Risk Profile</b>", centered_style)],
                [make_pie_chart(inherent_metrics, drawing_width=220), make_pie_chart(residual_metrics, drawing_width=220)]
            ]
            
            risk_chart_table = Table(risk_chart_table_data, colWidths=[230, 230])
            risk_chart_table.setStyle(TableStyle([
                ('ALIGN', (0,0), (-1,-1), 'CENTER'),
                ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                ('BOTTOMPADDING', (0,0), (-1,0), 6),
            ]))
            elements.append(risk_chart_table)
        
        elements.append(Spacer(1, 24))
        elements.append(Paragraph("<b>Executive Attestation &amp; Sign-Off</b>", styles['Heading3']))
        elements.append(Spacer(1, 6))
        
        attestation_text = (
            "By signing below, the undersigned executives attest that the information contained within this "
            "Compliance Audit Report accurately represents the organization's current security posture, control "
            "implementations, and enterprise risk register as of the date of generation. Management acknowledges "
            "responsibility for the design, implementation, and maintenance of internal controls relevant to the "
            "preparation and fair presentation of this report."
        )
        elements.append(Paragraph(attestation_text, styles['Normal']))
        elements.append(Spacer(1, 24))
        
        sign_table_data = [
            ["Prepared By: ___________________________", "Date: _________________"],
            ["Reviewed By (CISO/Admin): ______________", "Date: _________________"],
        ]
        sign_table = Table(sign_table_data, colWidths=[300, 168])
        sign_table.setStyle(TableStyle([
            ('FONTNAME', (0,0), (-1,-1), 'Helvetica'),
            ('FONTSIZE', (0,0), (-1,-1), 10),
            ('BOTTOMPADDING', (0,0), (-1,-1), 20),
        ]))
        elements.append(sign_table)
        elements.append(PageBreak())

    if export_data.get('controls'):
        all_tasks = []
        pending_qa = []
        failing_controls = []
        
        for c in export_data['controls']:
            for task in c.get('remediation_tasks', []):
                if task.get('status') != 'Resolved':
                    all_tasks.append({
                        'control_id': c.get('control_id'),
                        'title': task.get('title'),
                        'status': task.get('status'),
                        'assigned': task.get('assigned_to_username') or 'Unassigned'
                    })
            for a in c.get('assessments', []):
                if a.get('status') == 'In QA Review':
                    pending_qa.append([
                        c.get('control_id'),
                        a.get('assessor_username', 'Unknown'),
                        a.get('date_started', '')[:10]
                    ])
            if c.get('status') == 'Failing':
                failing_controls.append([
                    c.get('control_id'),
                    c.get('control_effectiveness', 'Not Tested'),
                    c.get('implementation_effectiveness', 'Not Tested')
                ])

        if all_tasks:
            elements.append(Paragraph("Plan of Action &amp; Milestones (POA&amp;M)", styles['Heading2']))
            elements.append(Spacer(1, 6))
            poam_data = [["Target Control", "Action Item Objective", "Assigned To", "Status"]]
            for t in all_tasks:
                poam_data.append([t['control_id'], t['title'], t['assigned'], t['status']])
            poam_table = make_paragraph_table(
                poam_data,
                col_widths=[92, 220, 82, 74],
                body_style=table_body_style,
                header_style=table_header_style,
            )
            poam_table.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1f2937')),
                ('ALIGN', (0,0), (-1,-1), 'LEFT'),
                ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ('LEFTPADDING', (0,0), (-1,-1), 6),
                ('RIGHTPADDING', (0,0), (-1,-1), 6),
                ('TOPPADDING', (0,0), (-1,-1), 5),
                ('BOTTOMPADDING', (0,0), (-1,-1), 5),
                ('BACKGROUND', (0,1), (-1,-1), colors.HexColor('#fef2f2')), 
                ('GRID', (0,0), (-1,-1), 1, colors.HexColor('#e5e7eb')),
            ]))
            elements.append(poam_table)
            elements.append(Spacer(1, 24))

        if pending_qa:
            elements.append(Paragraph("Pending Quality Assurance Reviews", styles['Heading2']))
            elements.append(Spacer(1, 6))
            qa_data = [["Target Control", "Assessed By", "Date Started"]] + pending_qa
            qa_table = make_paragraph_table(
                qa_data,
                col_widths=[110, 200, 158],
                body_style=table_body_style,
                header_style=table_header_style,
            )
            qa_table.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1f2937')),
                ('ALIGN', (0,0), (-1,-1), 'LEFT'),
                ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ('LEFTPADDING', (0,0), (-1,-1), 6),
                ('RIGHTPADDING', (0,0), (-1,-1), 6),
                ('TOPPADDING', (0,0), (-1,-1), 5),
                ('BOTTOMPADDING', (0,0), (-1,-1), 5),
                ('BACKGROUND', (0,1), (-1,-1), colors.HexColor('#fffbeb')), 
                ('GRID', (0,0), (-1,-1), 1, colors.HexColor('#e5e7eb')),
            ]))
            elements.append(qa_table)
            elements.append(Spacer(1, 24))

        if failing_controls:
            elements.append(Paragraph("Identified Control Weaknesses", styles['Heading2']))
            elements.append(Spacer(1, 6))
            weak_data = [["Target Control", "Design Effectiveness", "Operational Effectiveness"]] + failing_controls
            weak_table = make_paragraph_table(
                weak_data,
                col_widths=[110, 175, 183],
                body_style=table_body_style,
                header_style=table_header_style,
            )
            weak_table.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1f2937')),
                ('ALIGN', (0,0), (-1,-1), 'LEFT'),
                ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ('LEFTPADDING', (0,0), (-1,-1), 6),
                ('RIGHTPADDING', (0,0), (-1,-1), 6),
                ('TOPPADDING', (0,0), (-1,-1), 5),
                ('BOTTOMPADDING', (0,0), (-1,-1), 5),
                ('BACKGROUND', (0,1), (-1,-1), colors.HexColor('#fef2f2')), 
                ('GRID', (0,0), (-1,-1), 1, colors.HexColor('#e5e7eb')),
            ]))
            elements.append(weak_table)
            elements.append(PageBreak())

    if export_data.get('risks'):
        elements.append(Paragraph("Enterprise Risk Register &amp; Heatmap", styles['Heading2']))
        elements.append(Spacer(1, 6))
        elements.append(Paragraph("<b>Inherent Risk Heatmap</b>", styles['Heading3']))
        elements.append(Spacer(1, 6))

        heatmap_data = [["Likelihood \\ Impact", "1", "2", "3", "4", "5"]]
        heatmap_style = [
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTNAME', (0,0), (0,-1), 'Helvetica-Bold'),
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#f8fafc')),
            ('BACKGROUND', (0,0), (0,-1), colors.HexColor('#f8fafc')),
            ('GRID', (0,0), (-1,-1), 1, colors.HexColor('#e5e7eb')),
            ('BOTTOMPADDING', (0,0), (-1,-1), 8),
            ('TOPPADDING', (0,0), (-1,-1), 8),
        ]

        for i, likelihood in enumerate([5, 4, 3, 2, 1], start=1):
            row = [str(likelihood)]
            for j, impact in enumerate([1, 2, 3, 4, 5], start=1):
                score = likelihood * impact
                count = len([r for r in export_data['risks'] if r.get('inherent_likelihood') == likelihood and r.get('inherent_impact') == impact])
                row.append(str(count) if count > 0 else "")

                if count > 0:
                    if score >= 15: bg, tc = '#ef4444', '#ffffff' 
                    elif score >= 10: bg, tc = '#f97316', '#ffffff' 
                    elif score >= 5: bg, tc = '#eab308', '#000000' 
                    else: bg, tc = '#22c55e', '#ffffff' 
                else:
                    bg, tc = '#f1f5f9', '#000000'
                
                heatmap_style.append(('BACKGROUND', (j, i), (j, i), colors.HexColor(bg)))
                heatmap_style.append(('TEXTCOLOR', (j, i), (j, i), colors.HexColor(tc)))
            
            heatmap_data.append(row)

        hm_table = Table(heatmap_data, colWidths=[120, 40, 40, 40, 40, 40])
        hm_table.setStyle(TableStyle(heatmap_style))
        elements.append(hm_table)
        elements.append(Spacer(1, 16))

        risk_data = [["Risk ID", "Scenario", "Inherent", "Residual"]]
        for r in export_data['risks']:
            risk_data.append([r.get('risk_id', ''), r.get('title', ''), str(r.get('inherent_score', '')), str(r.get('residual_score', ''))])
        
        risk_table = make_paragraph_table(
            risk_data,
            col_widths=[72, 254, 71, 71],
            body_style=table_body_style,
            header_style=table_header_style,
        )
        risk_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1f2937')),
            ('ALIGN', (0,0), (-1,-1), 'LEFT'),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('LEFTPADDING', (0,0), (-1,-1), 6),
            ('RIGHTPADDING', (0,0), (-1,-1), 6),
            ('TOPPADDING', (0,0), (-1,-1), 5),
            ('BOTTOMPADDING', (0,0), (-1,-1), 5),
            ('BACKGROUND', (0,1), (-1,-1), colors.HexColor('#f8fafc')),
            ('GRID', (0,0), (-1,-1), 1, colors.HexColor('#e5e7eb')),
        ]))
        elements.append(risk_table)
        elements.append(PageBreak())

    if export_data.get('controls'):
        elements.append(Paragraph("Control Matrix Status", styles['Heading2']))
        elements.append(Spacer(1, 6))
        for c in export_data['controls']:
            elements.append(Paragraph(f"<b>{esc(c.get('control_id', ''))}</b> - {esc(c.get('status', ''))}", styles['Heading3']))
            elements.append(Paragraph(esc(c.get('description', '')), styles['Normal']))
            if c.get('cross_walked_control_ids'):
                safe_xwalk = ', '.join(esc(cid) for cid in c['cross_walked_control_ids'])
                elements.append(Spacer(1, 4))
                elements.append(Paragraph(f"<b>Cross-Walked Controls:</b> {safe_xwalk}", styles['Normal']))
            if c.get('evidence'):
                elements.append(Spacer(1, 4))
                elements.append(Paragraph(f"<b>Narrative:</b> {esc(c['evidence'])}", styles['Normal']))
            if c.get('proofs'):
                proof_names = [esc(p.get('name', 'Unknown File')) for p in c['proofs']]
                elements.append(Spacer(1, 4))
                elements.append(Paragraph(f"<b>Attached Evidence Artifacts:</b> {', '.join(proof_names)}", styles['Normal']))
            elements.append(Spacer(1, 12))
        elements.append(PageBreak())

    if export_data.get('audit_logs'):
        elements.append(PageBreak())
        elements.append(Spacer(1, 30))
        elements.append(Paragraph("Appendix A: Audit Trail Context", styles['Title']))
        elements.append(Spacer(1, 12))
        elements.append(Paragraph("The following logs detail the chronological change history grouped by their respective target controls or system resources. This provides forensic context for control evaluations, status changes, and evidence modifications.", styles['Normal']))
        elements.append(Spacer(1, 24))
        
        grouped_logs = {}
        for log in export_data['audit_logs']:
            res = log.get('object_repr', 'System Level')
            if res not in grouped_logs: grouped_logs[res] = []
            grouped_logs[res].append(log)
        
        for resource, logs in grouped_logs.items():
            elements.append(Paragraph(f"<b>Target Resource: {esc(resource)}</b>", styles['Heading3']))
            elements.append(Spacer(1, 6))
            
            log_table_data = [["Timestamp", "Actor", "Action"]]
            for log in logs[:10]: 
                ts = log.get('timestamp', '')[:19].replace('T', ' ')
                actor = log.get('actor_name', 'System')
                action_id = log.get('action')
                if action_id == 0: action_type = "Created"
                elif action_id == 1: action_type = f"Updated\n({log.get('changed_fields', '')})" if log.get('changed_fields') else "Updated"
                else: action_type = "Deleted"
                log_table_data.append([ts, actor, action_type])
            
            lt = make_paragraph_table(
                log_table_data,
                col_widths=[120, 100, 248],
                body_style=table_body_style,
                header_style=table_header_style,
            )
            lt.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1f2937')),
                ('ALIGN', (0,0), (-1,-1), 'LEFT'),
                ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ('LEFTPADDING', (0,0), (-1,-1), 6),
                ('RIGHTPADDING', (0,0), (-1,-1), 6),
                ('TOPPADDING', (0,0), (-1,-1), 5),
                ('BOTTOMPADDING', (0,0), (-1,-1), 5),
                ('BACKGROUND', (0,1), (-1,-1), colors.HexColor('#f8fafc')),
                ('GRID', (0,0), (-1,-1), 1, colors.HexColor('#e5e7eb')),
            ]))
            elements.append(lt)
            elements.append(Spacer(1, 16))

    doc.build(elements)
    return pdf_buffer