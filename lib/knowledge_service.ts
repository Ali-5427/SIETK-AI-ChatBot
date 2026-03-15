import { SIETK_KNOWLEDGE } from './Final Knowledge Base';

// A type guard to check if a key exists in an object
function isValidKey<T extends object>(obj: T, key: string | number | symbol): key is keyof T {
  return key in obj;
}

// --- START: DEPARTMENT MAPPING LOGIC ---

// Department name mapping to knowledge base keys
const DEPARTMENT_KEY_MAP: { [key: string]: string } = {
  'computer science and engineering': 'cse',
  'cse': 'cse',
  'electronics and communication engineering': 'ece',
  'ece': 'ece',
  'electrical and electronics engineering': 'eee',
  'eee': 'eee',
  'mechanical engineering': 'me',
  'me': 'me',
  'civil engineering': 'ce',
  'ce': 'ce',
  'computer science & information technology': 'csit',
  'csit': 'csit',
  'humanities and sciences': 'hs',
  'hs': 'hs',
  'master of business administration': 'mba',
  'mba': 'mba',
};

// Function to find the correct department key from a user query or department string
function getDeptKey(departmentQuery: string | undefined): string | undefined {
  if (!departmentQuery) return undefined;
  const lowerQuery = departmentQuery.toLowerCase().replace(/&/g, 'and');

  // Check for exact matches first for performance
  if (DEPARTMENT_KEY_MAP[lowerQuery]) {
    return DEPARTMENT_KEY_MAP[lowerQuery];
  }

  // Check for partial matches (e.g., "computer science" in "tell me about computer science")
  for (const name in DEPARTMENT_KEY_MAP) {
    if (lowerQuery.includes(name)) {
      return DEPARTMENT_KEY_MAP[name];
    }
  }
  return undefined;
}

// --- END: DEPARTMENT MAPPING LOGIC ---


// Helper function to correctly format the output of findData
function processFindDataResult(result: any): string | null {
  if (!result) {
    return null;
  }
  if (typeof result === 'string') {
    return result;
  }
  return JSON.stringify(result, null, 2);
}

// Main function to search the entire knowledge base
export function searchKnowledgeBase(query: string, department?: string, category?: string): string | null {
  const lowerQuery = query.toLowerCase();

  // Add specific handlers for high-value queries first
  if (lowerQuery.includes('chairman')) {
    return processFindDataResult(SIETK_KNOWLEDGE.management_and_leadership.founder_and_chairman);
  }
  if (lowerQuery.includes('principal')) {
    return processFindDataResult(SIETK_KNOWLEDGE.management_and_leadership.principal);
  }

  // Category-based search for higher precision
  if (category) {
    switch (category) {
      case 'faculty':
        return searchFaculty(lowerQuery, department || query);
      case 'curriculum':
      case 'syllabus':
        return searchCurriculum(lowerQuery, department || query);
      case 'fees':
        return processFindDataResult(findData(SIETK_KNOWLEDGE, 'fee'));
      case 'admissions':
        return processFindDataResult(SIETK_KNOWLEDGE.admissions);
      case 'placements':
        return processFindDataResult(SIETK_KNOWLEDGE.placements_and_training);
      case 'contact':
        return processFindDataResult(SIETK_KNOWLEDGE.college_overview);
    }
  }

  // General keyword-based search if no category is provided
  if (lowerQuery.includes('hod') || lowerQuery.includes('head of department')) {
    return searchFaculty(lowerQuery, department || query);
  }
  if (lowerQuery.includes('curriculum') || lowerQuery.includes('syllabus') || lowerQuery.includes('subjects')) {
    return searchCurriculum(lowerQuery, department || query);
  }
  if (lowerQuery.includes('faculty')) {
    return searchFaculty(lowerQuery, department || query);
  }
  if (lowerQuery.includes('fee') || lowerQuery.includes('scholarship')) {
    return processFindDataResult(findData(SIETK_KNOWLEDGE, 'fee'));
  }
  if (lowerQuery.includes('admission') || lowerQuery.includes('intake')) {
    return JSON.stringify(SIETK_KNOWLEDGE.admissions, null, 2);
  }
  if (lowerQuery.includes('placement') || lowerQuery.includes('recruiter')) {
    return JSON.stringify(SIETK_KNOWLEDGE.placements_and_training, null, 2);
  }

  // Fallback to a general search across the main knowledge base
  const result = findData(SIETK_KNOWLEDGE, lowerQuery);
  return processFindDataResult(result);
}

// Specialized function to search faculty data from the main knowledge base
function searchFaculty(query: string, department?: string): string | null {
  const deptKey = getDeptKey(department);

  if (deptKey && isValidKey(SIETK_KNOWLEDGE.departments, deptKey)) {
    const deptData = SIETK_KNOWLEDGE.departments[deptKey];

    if (query.includes('hod') || query.includes('head of department')) {
      return JSON.stringify({ [deptKey]: { hod: deptData.hod } }, null, 2);
    }
    
    // This is now future-proof for when a full faculty list is added to the knowledge base.
    if (deptData.faculty) {
      return JSON.stringify({ [deptKey]: { faculty: deptData.faculty } }, null, 2);
    }

    // If only HOD info is available, return that as a proxy for faculty info.
    return JSON.stringify({ [deptKey]: { hod: deptData.hod } }, null, 2);
  }

  // If no specific department is found, search for HODs across all departments if requested
  if (query.includes('hod')) {
    const allHODs = Object.keys(SIETK_KNOWLEDGE.departments).reduce((acc, key) => {
      if (isValidKey(SIETK_KNOWLEDGE.departments, key)) {
        acc[key] = SIETK_KNOWLEDGE.departments[key].hod;
      }
      return acc;
    }, {} as { [key: string]: any });
    return JSON.stringify(allHODs, null, 2);
  }

  return "Please specify a department to get faculty information (e.g., 'CSE faculty').";
}

// Specialized function to search curriculum data from the main knowledge base
function searchCurriculum(query: string, department?: string): string | null {
  const deptKey = getDeptKey(department);

  if (deptKey && isValidKey(SIETK_KNOWLEDGE.departments, deptKey)) {
     // This part is ready for when curriculum is added per department in the knowledge base
  }

  // For now, always return the main curriculum and examinations info
  return JSON.stringify(SIETK_KNOWLEDGE.curriculum_and_examinations, null, 2);
}

// Recursive helper function to find data within any object - NOW MORE PRECISE
function findData(data: any, query: string): any | null {
  if (!data) return null;

  if (typeof data === 'string' && data.toLowerCase().includes(query)) {
    return data;
  }

  if (typeof data === 'object') {
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        if (key.toLowerCase().includes(query)) {
          return data[key]; // Return the specific value for the matching key
        }

        const nestedResult = findData(data[key], query);
        if (nestedResult) {
          return nestedResult;
        }
      }
    }
  }

  return null;
}
