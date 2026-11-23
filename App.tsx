import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getDocuments, getFolders, initDatabase } from './src/storage/database';
import type { DocumentRecord, Folder } from './src/types/models';
import { HomeScreen } from './src/screens/HomeScreen';
import { DocumentDetailScreen } from './src/screens/DocumentDetailScreen';
import { SafeBottomProvider } from './src/hooks/useSafeBottom';
import { COLORS } from './src/theme/colors';

export default function App() {
  const [ready, setReady] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activeFolder, setActiveFolder] = useState<
    'ALL' | 'SIGNED' | 'PROTECTED' | 'UNASSIGNED' | string
  >('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);

  const refreshData = useCallback(
    (folderFilter = activeFolder, query = searchQuery) => {
      setFolders(getFolders());
      setDocuments(getDocuments({ folderFilter, searchQuery: query }));
    },
    [activeFolder, searchQuery]
  );

  useEffect(() => {
    initDatabase();
    setReady(true);
    setFolders(getFolders());
    setDocuments(getDocuments({ folderFilter: 'ALL', searchQuery: '' }));
  }, []);

  useEffect(() => {
    if (!ready) return;
    refreshData(activeFolder, searchQuery);
  }, [ready, activeFolder, searchQuery, refreshData]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (openDocumentId) {
        setOpenDocumentId(null);
        refreshData();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [openDocumentId, refreshData]);

  if (!ready) {
    return <View style={styles.boot} />;
  }

  return (
    <SafeAreaProvider>
      <SafeBottomProvider>
        <StatusBar style="dark" />
        {openDocumentId ? (
          <DocumentDetailScreen
            documentId={openDocumentId}
            folders={folders}
            onBack={() => {
              setOpenDocumentId(null);
              refreshData();
            }}
            onDataChanged={() => refreshData()}
          />
        ) : (
          <HomeScreen
            folders={folders}
            documents={documents}
            activeFolder={activeFolder}
            searchQuery={searchQuery}
            onChangeFolder={setActiveFolder}
            onChangeSearch={setSearchQuery}
            onRefresh={() => refreshData()}
            onOpenDocument={(id) => setOpenDocumentId(id)}
          />
        )}
      </SafeBottomProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
});
