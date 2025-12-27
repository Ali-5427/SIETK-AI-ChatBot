const fs = require('fs');
const path = 'c:\\Users\\Admin\\Downloads\\SIETK ChatBot\\sietk-ai-chatbot\\lib\\sietk-knowledge-base.ts';
let content = fs.readFileSync(path, 'utf8');

// Loose matching strings to identify blocks regardless of emoji encoding
const feeStartMarker = "// Fees";
const feeEndMarker = "// Courses / Programs";

const placementStartMarker = "// Placement";
const placementEndMarker = "// Achievements";

// NEW BLOCKS

const newFeeBlock = `// Fees
  if (q.includes('fee') || q.includes('cost') || q.includes('tuition') || q.includes('price')) {
    const fees = SIETK_KNOWLEDGE_BASE.fees
    return \`## SIETK Fee Structure 💰

**B.Tech Programs (All branches):**
- Rs. **\${fees.btech.amount.toLocaleString()}** per year

**Post Graduate Programs:**
- MBA: Rs. **\${fees.mba.amount.toLocaleString()}** per year
- MCA: Rs. **\${fees.mca.amount.toLocaleString()}** per year

**Hostel Fees:**
- Rs. **\${fees.hostel.amount.toLocaleString()}** \${fees.hostel.period}
- *\${fees.hostel.note}*

**Note:**
- 70% seats allotted through APEAPCET counselling
- 30% management quota
- Scholarships available for eligible students
- Government fee reimbursement schemes applicable

📞 Contact Admissions: \${SIETK_KNOWLEDGE_BASE.about.phone}\`
  }

  // HODs / Heads of Departments
  if (q.includes('hod') || q.includes('head') || q.includes('dept')) {
    const depts = SIETK_KNOWLEDGE_BASE.departments
    let response = \`## Heads of Departments (HODs) 👨‍🏫\\n\\n\`
    
    // Check for specific department request
    if (q.includes('civil')) return \`## HOD - Civil Engineering\\n\\n**\${depts.civil.hod}**\\n\\n📞 Contact: \${SIETK_KNOWLEDGE_BASE.about.phone}\`
    if (q.includes('cse') || q.includes('computer')) return \`## HOD - CSE\\n\\n**Dr. B. Geethavani** (Professor & HOD)\\n\\n📞 Contact: \${SIETK_KNOWLEDGE_BASE.about.phone}\`
    if (q.includes('ece')) return \`## HOD - ECE\\n\\n**Dr. P. Ratna Kamala**\\n\\n📞 Contact: \${SIETK_KNOWLEDGE_BASE.about.phone}\`
    if (q.includes('eee')) return \`## HOD - EEE\\n\\n**Dr. N. Gireesh**\\n\\n📞 Contact: \${SIETK_KNOWLEDGE_BASE.about.phone}\`
    if (q.includes('mech')) return \`## HOD - Mechanical\\n\\n**Dr. S. Sunil Kumar Reddy**\\n\\n📞 Contact: \${SIETK_KNOWLEDGE_BASE.about.phone}\`
    if (q.includes('mba')) return \`## HOD - MBA\\n\\n**\${depts.mba.head}**\\n\\n📞 Contact: \${SIETK_KNOWLEDGE_BASE.about.phone}\`
    if (q.includes('mca')) return \`## HOD - MCA\\n\\n**\${depts.mca.head}**\\n\\n📞 Contact: \${SIETK_KNOWLEDGE_BASE.about.phone}\`

    return response + \`Please specify which department's HOD you are looking for (e.g., "Who is HOD of Civil?").\`
  }`;

const newPlacementBlock = `// Placement
  if (q.includes('placement') || q.includes('job') || q.includes('recruit') || q.includes('company') || q.includes('career') || q.includes('package') || q.includes('salary')) {
    const plc = SIETK_KNOWLEDGE_BASE.placements
    return \`## SIETK Placements & Training 💼

**Placement Highlights:**
- **Highest Package:** \${plc.stats.highestPackage} 🚀
- **Average Package:** \${plc.stats.averagePackage}
- **Placement Rate:** \${plc.stats.placementRate}

**Top Recruiters:**
\${plc.stats.topRecruiters.map(r => \`- \${r}\`).join('\\n')}

**About \${plc.department}:**
\${plc.description}

**Services Offered:**
\${plc.services.map(s => \`- \${s}\`).join('\\n')}

**Contact:**
- Email: \${plc.contact.email}
- Phone: \${plc.contact.phone}
- Background Verification: \${plc.contact.backgroundVerification}

🌐 Visit: \${SIETK_KNOWLEDGE_BASE.about.website}\`
  }`;


// EXECUTE REPLACEMENT
let modified = false;

const feeStartIdx = content.indexOf(feeStartMarker);
const feeEndIdx = content.indexOf(feeEndMarker);

if (feeStartIdx !== -1 && feeEndIdx !== -1) {
    const before = content.substring(0, feeStartIdx);
    const after = content.substring(feeEndIdx);
    content = before + newFeeBlock + "\n\n  " + after;
    modified = true;
    console.log("Updated Fee Block");
} else {
    console.error("Could not locate Fee section markers");
}

const placeStartIdx = content.indexOf(placementStartMarker);
const placeEndIdx = content.indexOf(placementEndMarker);

if (placeStartIdx !== -1 && placeEndIdx !== -1) {
    const before = content.substring(0, placeStartIdx);
    const after = content.substring(placeEndIdx);
    content = before + newPlacementBlock + "\n\n  " + after;
    modified = true;
    console.log("Updated Placement Block");
} else {
    console.error("Could not locate Placement section markers");
}

if (modified) {
    fs.writeFileSync(path, content, 'utf8');
    console.log("Successfully patched knowledge base");
}
